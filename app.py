from __future__ import annotations

import hashlib
import json
import mimetypes
import secrets
import sqlite3
import threading
from datetime import datetime
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
INSTANCE_DIR = BASE_DIR / "instance"
DB_PATH = INSTANCE_DIR / "disaster_system.db"

HOST = "127.0.0.1"
PORT = 8000

ROLE_CHOICES = ("Admin", "Officer")
SEVERITY_LEVELS = ("Low", "Moderate", "High", "Critical")
ALERT_LEVELS = ("Advisory", "Watch", "Warning", "Emergency")
DEFAULT_ORGANIZATION_TYPES = (
    "Government",
    "Health",
    "Fire and Rescue",
    "Police",
    "Volunteer Group",
    "Relief Organization",
)

SESSIONS: dict[str, int] = {}
SESSION_LOCK = threading.Lock()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_name TEXT NOT NULL,
    barangay TEXT NOT NULL,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    population INTEGER NOT NULL CHECK (population >= 0),
    UNIQUE (community_name, barangay, city, province)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Admin', 'Officer')),
    email TEXT NOT NULL UNIQUE,
    FOREIGN KEY (community_id) REFERENCES communities (id)
);

CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_name TEXT NOT NULL,
    type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations (id),
    FOREIGN KEY (community_id) REFERENCES communities (id)
);

CREATE TABLE IF NOT EXISTS contact_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    phone_number TEXT NOT NULL,
    network TEXT NOT NULL,
    FOREIGN KEY (contact_id) REFERENCES emergency_contacts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS disasters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    disaster_type TEXT NOT NULL,
    description TEXT NOT NULL,
    severity_level TEXT NOT NULL CHECK (severity_level IN ('Low', 'Moderate', 'High', 'Critical')),
    date_occurred TEXT NOT NULL,
    FOREIGN KEY (community_id) REFERENCES communities (id)
);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    disaster_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    alert_level TEXT NOT NULL CHECK (alert_level IN ('Advisory', 'Watch', 'Warning', 'Emergency')),
    date_issued TEXT NOT NULL,
    FOREIGN KEY (disaster_id) REFERENCES disasters (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evacuation_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    center_name TEXT NOT NULL,
    location TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity >= 0),
    FOREIGN KEY (community_id) REFERENCES communities (id)
);

CREATE TABLE IF NOT EXISTS center_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_id INTEGER NOT NULL,
    contact_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    FOREIGN KEY (center_id) REFERENCES evacuation_centers (id) ON DELETE CASCADE
);
"""


class ApiError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def ensure_directories() -> None:
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def normalize_text(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise ApiError(400, f"{field_name} must be a text value.")
    cleaned = value.strip()
    if not cleaned:
        raise ApiError(400, f"{field_name} is required.")
    return cleaned


def normalize_email(value: object, field_name: str = "email") -> str:
    email = normalize_text(value, field_name).lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ApiError(400, f"{field_name} must be a valid email address.")
    return email


def normalize_int(value: object, field_name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ApiError(400, f"{field_name} must be a whole number.") from error
    if parsed < 0:
        raise ApiError(400, f"{field_name} must not be negative.")
    return parsed


def normalize_role(value: object) -> str:
    role = normalize_text(value, "role")
    if role not in ROLE_CHOICES:
        raise ApiError(400, f"role must be one of: {', '.join(ROLE_CHOICES)}.")
    return role


def normalize_severity(value: object) -> str:
    severity = normalize_text(value, "severity_level")
    if severity not in SEVERITY_LEVELS:
        raise ApiError(400, f"severity_level must be one of: {', '.join(SEVERITY_LEVELS)}.")
    return severity


def normalize_alert_level(value: object) -> str:
    alert_level = normalize_text(value, "alert_level")
    if alert_level not in ALERT_LEVELS:
        raise ApiError(400, f"alert_level must be one of: {', '.join(ALERT_LEVELS)}.")
    return alert_level


def normalize_date(value: object, field_name: str) -> str:
    date_value = normalize_text(value, field_name)
    try:
        datetime.strptime(date_value, "%Y-%m-%d")
    except ValueError as error:
        raise ApiError(400, f"{field_name} must use YYYY-MM-DD format.") from error
    return date_value


def normalize_id(value: object, field_name: str) -> int:
    parsed = normalize_int(value, field_name)
    if parsed == 0:
        raise ApiError(400, f"{field_name} must be a valid identifier.")
    return parsed


def community_label(row: sqlite3.Row | dict) -> str:
    return f"{row['community_name']} - {row['barangay']}, {row['city']}, {row['province']}"


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def fetch_communities(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT
            c.*,
            (SELECT COUNT(*) FROM users u WHERE u.community_id = c.id) AS user_count,
            (SELECT COUNT(*) FROM emergency_contacts ec WHERE ec.community_id = c.id) AS contact_count,
            (SELECT COUNT(*) FROM disasters d WHERE d.community_id = c.id) AS disaster_count,
            (SELECT COUNT(*) FROM evacuation_centers ev WHERE ev.community_id = c.id) AS center_count
        FROM communities c
        ORDER BY c.province, c.city, c.barangay, c.community_name
        """
    ).fetchall()
    results = []
    for row in rows:
        item = row_to_dict(row)
        item["label"] = community_label(row)
        results.append(item)
    return results


def fetch_users(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT
            u.id,
            u.full_name,
            u.username,
            u.role,
            u.email,
            u.community_id,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM users u
        JOIN communities c ON c.id = u.community_id
        ORDER BY
            CASE u.role WHEN 'Admin' THEN 1 WHEN 'Officer' THEN 2 ELSE 3 END,
            u.full_name
        """
    ).fetchall()
    results = []
    for row in rows:
        item = row_to_dict(row)
        item["community_label"] = community_label(row)
        results.append(item)
    return results


def fetch_organizations(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT
            o.*,
            (SELECT COUNT(*) FROM emergency_contacts ec WHERE ec.organization_id = o.id) AS contact_count
        FROM organizations o
        ORDER BY o.organization_name
        """
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def fetch_contacts(connection: sqlite3.Connection) -> list[dict]:
    contact_rows = connection.execute(
        """
        SELECT
            ec.id,
            ec.name,
            ec.role,
            ec.email,
            ec.organization_id,
            ec.community_id,
            o.organization_name,
            o.type AS organization_type,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM emergency_contacts ec
        JOIN organizations o ON o.id = ec.organization_id
        JOIN communities c ON c.id = ec.community_id
        ORDER BY ec.name
        """
    ).fetchall()
    number_rows = connection.execute(
        """
        SELECT id, contact_id, phone_number, network
        FROM contact_numbers
        ORDER BY contact_id, id
        """
    ).fetchall()

    numbers_by_contact: dict[int, list[dict]] = {}
    for row in number_rows:
        numbers_by_contact.setdefault(row["contact_id"], []).append(row_to_dict(row))

    contacts = []
    for row in contact_rows:
        item = row_to_dict(row)
        item["community_label"] = community_label(row)
        item["phone_numbers"] = numbers_by_contact.get(row["id"], [])
        contacts.append(item)
    return contacts


def fetch_disasters(connection: sqlite3.Connection) -> list[dict]:
    disaster_rows = connection.execute(
        """
        SELECT
            d.id,
            d.community_id,
            d.disaster_type,
            d.description,
            d.severity_level,
            d.date_occurred,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM disasters d
        JOIN communities c ON c.id = d.community_id
        ORDER BY d.date_occurred DESC, d.id DESC
        """
    ).fetchall()
    announcement_rows = connection.execute(
        """
        SELECT id, disaster_id, title, message, alert_level, date_issued
        FROM announcements
        ORDER BY date_issued DESC, id DESC
        """
    ).fetchall()

    announcements_by_disaster: dict[int, list[dict]] = {}
    for row in announcement_rows:
        announcements_by_disaster.setdefault(row["disaster_id"], []).append(row_to_dict(row))

    disasters = []
    for row in disaster_rows:
        item = row_to_dict(row)
        item["community_label"] = community_label(row)
        item["announcements"] = announcements_by_disaster.get(row["id"], [])
        disasters.append(item)
    return disasters


def fetch_centers(connection: sqlite3.Connection) -> list[dict]:
    center_rows = connection.execute(
        """
        SELECT
            ev.id,
            ev.community_id,
            ev.center_name,
            ev.location,
            ev.capacity,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM evacuation_centers ev
        JOIN communities c ON c.id = ev.community_id
        ORDER BY ev.center_name
        """
    ).fetchall()
    contact_rows = connection.execute(
        """
        SELECT id, center_id, contact_name, phone_number
        FROM center_contacts
        ORDER BY center_id, id
        """
    ).fetchall()

    contacts_by_center: dict[int, list[dict]] = {}
    for row in contact_rows:
        contacts_by_center.setdefault(row["center_id"], []).append(row_to_dict(row))

    centers = []
    for row in center_rows:
        item = row_to_dict(row)
        item["community_label"] = community_label(row)
        item["center_contacts"] = contacts_by_center.get(row["id"], [])
        centers.append(item)
    return centers


def fetch_dashboard(connection: sqlite3.Connection) -> dict:
    communities = fetch_communities(connection)
    contacts = fetch_contacts(connection)
    disasters = fetch_disasters(connection)
    centers = fetch_centers(connection)
    users = fetch_users(connection)
    organizations = fetch_organizations(connection)

    recent_announcements = connection.execute(
        """
        SELECT
            a.id,
            a.title,
            a.message,
            a.alert_level,
            a.date_issued,
            d.disaster_type,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM announcements a
        JOIN disasters d ON d.id = a.disaster_id
        JOIN communities c ON c.id = d.community_id
        ORDER BY a.date_issued DESC, a.id DESC
        LIMIT 5
        """
    ).fetchall()

    counts = {
        "communities": len(communities),
        "users": len(users),
        "organizations": len(organizations),
        "contacts": len(contacts),
        "disasters": len(disasters),
        "announcements": sum(len(disaster["announcements"]) for disaster in disasters),
        "centers": len(centers),
    }

    return {
        "counts": counts,
        "communities": communities[:3],
        "contacts": contacts[:6],
        "disasters": disasters[:4],
        "recent_announcements": [
            {**row_to_dict(row), "community_label": community_label(row)} for row in recent_announcements
        ],
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def fetch_lookups(connection: sqlite3.Connection) -> dict:
    communities = fetch_communities(connection)
    organizations = fetch_organizations(connection)
    disasters = fetch_disasters(connection)
    centers = fetch_centers(connection)
    return {
        "communities": [{"id": item["id"], "label": f"CommunityID {item['id']} - {item['label']}"} for item in communities],
        "organizations": [
            {"id": item["id"], "label": f"OrganizationID {item['id']} - {item['organization_name']}", "type": item["type"]}
            for item in organizations
        ],
        "disasters": [
            {
                "id": item["id"],
                "label": f"DisasterID {item['id']} - {item['disaster_type']} - {item['date_occurred']} ({item['community_name']})",
            }
            for item in disasters
        ],
        "centers": [{"id": item["id"], "label": f"CenterID {item['id']} - {item['center_name']}"} for item in centers],
        "roles": list(ROLE_CHOICES),
        "severity_levels": list(SEVERITY_LEVELS),
        "alert_levels": list(ALERT_LEVELS),
        "organization_types": list(DEFAULT_ORGANIZATION_TYPES),
    }


def fetch_current_user(connection: sqlite3.Connection, user_id: int) -> dict | None:
    row = connection.execute(
        """
        SELECT
            u.id,
            u.full_name,
            u.username,
            u.role,
            u.email,
            u.community_id,
            c.community_name,
            c.barangay,
            c.city,
            c.province
        FROM users u
        JOIN communities c ON c.id = u.community_id
        WHERE u.id = ?
        """,
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    item = row_to_dict(row)
    item["community_label"] = community_label(row)
    return item


def seed_database(connection: sqlite3.Connection) -> None:
    community_id = connection.execute(
        """
        INSERT INTO communities (community_name, barangay, city, province, population)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("San Isidro Resilience Hub", "Salvacion", "Goa", "Camarines Sur", 2840),
    ).lastrowid

    users = [
        (community_id, "Ayesa P. Alerta", "admin", hash_password("admin123"), "Admin", "admin@sanisidro.local"),
        (
            community_id,
            "Jovert A. Pabon",
            "officer",
            hash_password("officer123"),
            "Officer",
            "officer@sanisidro.local",
        ),
    ]
    connection.executemany(
        """
        INSERT INTO users (community_id, full_name, username, password_hash, role, email)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        users,
    )

    organizations = [
        ("Partido MDRRMO", "Government"),
        ("Goa Rural Health Unit", "Health"),
        ("Bureau of Fire Protection - Goa", "Fire and Rescue"),
        ("Philippine National Police - Goa", "Police"),
    ]
    connection.executemany(
        """
        INSERT INTO organizations (organization_name, type)
        VALUES (?, ?)
        """,
        organizations,
    )

    org_map = {
        row["organization_name"]: row["id"]
        for row in connection.execute("SELECT id, organization_name FROM organizations").fetchall()
    }

    contacts = [
        (org_map["Partido MDRRMO"], community_id, "Kirby H. Paladan", "Municipal DRRM Officer", "mdrrmo@goa.local"),
        (
            org_map["Goa Rural Health Unit"],
            community_id,
            "Nurse Maria Santos",
            "Emergency Health Coordinator",
            "rhu@goa.local",
        ),
        (org_map["Bureau of Fire Protection - Goa"], community_id, "FO2 Daniel Cruz", "Fire Marshal", "bfp@goa.local"),
    ]
    connection.executemany(
        """
        INSERT INTO emergency_contacts (organization_id, community_id, name, role, email)
        VALUES (?, ?, ?, ?, ?)
        """,
        contacts,
    )

    contact_map = {
        row["name"]: row["id"]
        for row in connection.execute("SELECT id, name FROM emergency_contacts").fetchall()
    }
    numbers = [
        (contact_map["Kirby H. Paladan"], "09171234567", "Globe"),
        (contact_map["Kirby H. Paladan"], "09981234567", "Smart"),
        (contact_map["Nurse Maria Santos"], "09192345678", "DITO"),
        (contact_map["FO2 Daniel Cruz"], "09283456789", "Globe"),
    ]
    connection.executemany(
        """
        INSERT INTO contact_numbers (contact_id, phone_number, network)
        VALUES (?, ?, ?)
        """,
        numbers,
    )

    disaster_id = connection.execute(
        """
        INSERT INTO disasters (community_id, disaster_type, description, severity_level, date_occurred)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            community_id,
            "Typhoon",
            "Heavy rainfall caused road flooding near the riverbanks and interrupted transport.",
            "High",
            "2026-03-18",
        ),
    ).lastrowid
    connection.execute(
        """
        INSERT INTO disasters (community_id, disaster_type, description, severity_level, date_occurred)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            community_id,
            "Flood",
            "Overflowing drainage affected low-lying puroks and triggered precautionary evacuation.",
            "Moderate",
            "2026-04-02",
        ),
    )

    announcements = [
        (
            disaster_id,
            "Pre-emptive Evacuation Advisory",
            "Residents in Purok 3 and Purok 5 should prepare for possible overnight evacuation.",
            "Watch",
            "2026-03-18",
        ),
        (
            disaster_id,
            "Emergency Hotline Reminder",
            "Keep emergency lines open and bring medicine, water, and IDs before moving to the center.",
            "Warning",
            "2026-03-18",
        ),
    ]
    connection.executemany(
        """
        INSERT INTO announcements (disaster_id, title, message, alert_level, date_issued)
        VALUES (?, ?, ?, ?, ?)
        """,
        announcements,
    )

    center_id = connection.execute(
        """
        INSERT INTO evacuation_centers (community_id, center_name, location, capacity)
        VALUES (?, ?, ?, ?)
        """,
        (community_id, "San Isidro Covered Court", "Zone 2, near Barangay Hall", 350),
    ).lastrowid
    connection.execute(
        """
        INSERT INTO evacuation_centers (community_id, center_name, location, capacity)
        VALUES (?, ?, ?, ?)
        """,
        (community_id, "Partido State University Gym", "Main campus compound, Goa", 500),
    )
    connection.executemany(
        """
        INSERT INTO center_contacts (center_id, contact_name, phone_number)
        VALUES (?, ?, ?)
        """,
        [
            (center_id, "Barangay Captain Elena Ramos", "09174567890"),
            (center_id, "Logistics Volunteer Desk", "09294567890"),
        ],
    )


def migrate_user_role_constraint(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    if row is None:
        return

    has_legacy_resident_role = "'Resident'" in row["sql"]
    if not has_legacy_resident_role:
        connection.execute("DELETE FROM users WHERE role NOT IN ('Admin', 'Officer')")
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute(
        """
        CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            community_id INTEGER NOT NULL,
            full_name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('Admin', 'Officer')),
            email TEXT NOT NULL UNIQUE,
            FOREIGN KEY (community_id) REFERENCES communities (id)
        )
        """
    )
    connection.execute(
        """
        INSERT INTO users_new (id, community_id, full_name, username, password_hash, role, email)
        SELECT id, community_id, full_name, username, password_hash, role, email
        FROM users
        WHERE role IN ('Admin', 'Officer')
        """
    )
    connection.execute("DROP TABLE users")
    connection.execute("ALTER TABLE users_new RENAME TO users")
    connection.execute("PRAGMA foreign_keys = ON")


def initialize_database() -> None:
    ensure_directories()
    with get_connection() as connection:
        connection.executescript(SCHEMA_SQL)
        migrate_user_role_constraint(connection)
        community_count = connection.execute("SELECT COUNT(*) FROM communities").fetchone()[0]
        if community_count == 0:
            seed_database(connection)
        connection.commit()


def generate_export(connection: sqlite3.Connection) -> dict:
    return {
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "communities": fetch_communities(connection),
        "users": fetch_users(connection),
        "organizations": fetch_organizations(connection),
        "emergency_contacts": fetch_contacts(connection),
        "disasters": fetch_disasters(connection),
        "evacuation_centers": fetch_centers(connection),
    }


def require_record(connection: sqlite3.Connection, table: str, item_id: int) -> sqlite3.Row:
    row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise ApiError(404, f"{table.replace('_', ' ').title()} not found.")
    return row


def create_community(connection: sqlite3.Connection, payload: dict) -> None:
    community_name = normalize_text(payload.get("community_name"), "community_name")
    barangay = normalize_text(payload.get("barangay"), "barangay")
    city = normalize_text(payload.get("city"), "city")
    province = normalize_text(payload.get("province"), "province")
    population = normalize_int(payload.get("population"), "population")

    initial_user = payload.get("initial_user")
    if not isinstance(initial_user, dict):
        raise ApiError(400, "initial_user is required when creating a community.")

    full_name = normalize_text(initial_user.get("full_name"), "initial_user.full_name")
    username = normalize_text(initial_user.get("username"), "initial_user.username")
    password = normalize_text(initial_user.get("password"), "initial_user.password")
    role = normalize_role(initial_user.get("role"))
    email = normalize_email(initial_user.get("email"), "initial_user.email")

    community_id = connection.execute(
        """
        INSERT INTO communities (community_name, barangay, city, province, population)
        VALUES (?, ?, ?, ?, ?)
        """,
        (community_name, barangay, city, province, population),
    ).lastrowid
    connection.execute(
        """
        INSERT INTO users (community_id, full_name, username, password_hash, role, email)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (community_id, full_name, username, hash_password(password), role, email),
    )


def update_community(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "communities", item_id)
    connection.execute(
        """
        UPDATE communities
        SET community_name = ?, barangay = ?, city = ?, province = ?, population = ?
        WHERE id = ?
        """,
        (
            normalize_text(payload.get("community_name"), "community_name"),
            normalize_text(payload.get("barangay"), "barangay"),
            normalize_text(payload.get("city"), "city"),
            normalize_text(payload.get("province"), "province"),
            normalize_int(payload.get("population"), "population"),
            item_id,
        ),
    )


def delete_community(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "communities", item_id)
    connection.execute("DELETE FROM communities WHERE id = ?", (item_id,))


def create_user(connection: sqlite3.Connection, payload: dict) -> None:
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)
    connection.execute(
        """
        INSERT INTO users (community_id, full_name, username, password_hash, role, email)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            community_id,
            normalize_text(payload.get("full_name"), "full_name"),
            normalize_text(payload.get("username"), "username"),
            hash_password(normalize_text(payload.get("password"), "password")),
            normalize_role(payload.get("role")),
            normalize_email(payload.get("email")),
        ),
    )


def update_user(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    user = require_record(connection, "users", item_id)
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)

    password = payload.get("password")
    password_hash = user["password_hash"]
    if isinstance(password, str) and password.strip():
        password_hash = hash_password(password.strip())

    connection.execute(
        """
        UPDATE users
        SET community_id = ?, full_name = ?, username = ?, password_hash = ?, role = ?, email = ?
        WHERE id = ?
        """,
        (
            community_id,
            normalize_text(payload.get("full_name"), "full_name"),
            normalize_text(payload.get("username"), "username"),
            password_hash,
            normalize_role(payload.get("role")),
            normalize_email(payload.get("email")),
            item_id,
        ),
    )


def delete_user(connection: sqlite3.Connection, item_id: int, current_user_id: int) -> None:
    user = require_record(connection, "users", item_id)
    if item_id == current_user_id:
        raise ApiError(400, "You cannot delete the account currently in use.")

    remaining = connection.execute(
        "SELECT COUNT(*) FROM users WHERE community_id = ?",
        (user["community_id"],),
    ).fetchone()[0]
    if remaining <= 1:
        raise ApiError(400, "Each community must keep at least one user.")

    connection.execute("DELETE FROM users WHERE id = ?", (item_id,))


def create_organization(connection: sqlite3.Connection, payload: dict) -> None:
    connection.execute(
        """
        INSERT INTO organizations (organization_name, type)
        VALUES (?, ?)
        """,
        (
            normalize_text(payload.get("organization_name"), "organization_name"),
            normalize_text(payload.get("type"), "type"),
        ),
    )


def update_organization(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "organizations", item_id)
    connection.execute(
        """
        UPDATE organizations
        SET organization_name = ?, type = ?
        WHERE id = ?
        """,
        (
            normalize_text(payload.get("organization_name"), "organization_name"),
            normalize_text(payload.get("type"), "type"),
            item_id,
        ),
    )


def delete_organization(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "organizations", item_id)
    connection.execute("DELETE FROM organizations WHERE id = ?", (item_id,))


def normalize_phone_numbers(items: object) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ApiError(400, "At least one contact number is required.")
    results = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ApiError(400, f"phone_numbers[{index}] must be an object.")
        results.append(
            {
                "phone_number": normalize_text(item.get("phone_number"), f"phone_numbers[{index}].phone_number"),
                "network": normalize_text(item.get("network"), f"phone_numbers[{index}].network"),
            }
        )
    return results


def normalize_center_contacts(items: object) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ApiError(400, "At least one center contact is required.")
    results = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ApiError(400, f"center_contacts[{index}] must be an object.")
        results.append(
            {
                "contact_name": normalize_text(item.get("contact_name"), f"center_contacts[{index}].contact_name"),
                "phone_number": normalize_text(item.get("phone_number"), f"center_contacts[{index}].phone_number"),
            }
        )
    return results


def create_contact(connection: sqlite3.Connection, payload: dict) -> None:
    organization_id = normalize_id(payload.get("organization_id"), "organization_id")
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "organizations", organization_id)
    require_record(connection, "communities", community_id)
    phone_numbers = normalize_phone_numbers(payload.get("phone_numbers"))

    contact_id = connection.execute(
        """
        INSERT INTO emergency_contacts (organization_id, community_id, name, role, email)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            organization_id,
            community_id,
            normalize_text(payload.get("name"), "name"),
            normalize_text(payload.get("role"), "role"),
            normalize_email(payload.get("email")),
        ),
    ).lastrowid
    connection.executemany(
        """
        INSERT INTO contact_numbers (contact_id, phone_number, network)
        VALUES (?, ?, ?)
        """,
        [(contact_id, item["phone_number"], item["network"]) for item in phone_numbers],
    )


def update_contact(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "emergency_contacts", item_id)
    organization_id = normalize_id(payload.get("organization_id"), "organization_id")
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "organizations", organization_id)
    require_record(connection, "communities", community_id)
    phone_numbers = normalize_phone_numbers(payload.get("phone_numbers"))

    connection.execute(
        """
        UPDATE emergency_contacts
        SET organization_id = ?, community_id = ?, name = ?, role = ?, email = ?
        WHERE id = ?
        """,
        (
            organization_id,
            community_id,
            normalize_text(payload.get("name"), "name"),
            normalize_text(payload.get("role"), "role"),
            normalize_email(payload.get("email")),
            item_id,
        ),
    )
    connection.execute("DELETE FROM contact_numbers WHERE contact_id = ?", (item_id,))
    connection.executemany(
        """
        INSERT INTO contact_numbers (contact_id, phone_number, network)
        VALUES (?, ?, ?)
        """,
        [(item_id, item["phone_number"], item["network"]) for item in phone_numbers],
    )


def delete_contact(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "emergency_contacts", item_id)
    connection.execute("DELETE FROM emergency_contacts WHERE id = ?", (item_id,))


def create_disaster(connection: sqlite3.Connection, payload: dict) -> None:
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)
    connection.execute(
        """
        INSERT INTO disasters (community_id, disaster_type, description, severity_level, date_occurred)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            community_id,
            normalize_text(payload.get("disaster_type"), "disaster_type"),
            normalize_text(payload.get("description"), "description"),
            normalize_severity(payload.get("severity_level")),
            normalize_date(payload.get("date_occurred"), "date_occurred"),
        ),
    )


def update_disaster(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "disasters", item_id)
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)
    connection.execute(
        """
        UPDATE disasters
        SET community_id = ?, disaster_type = ?, description = ?, severity_level = ?, date_occurred = ?
        WHERE id = ?
        """,
        (
            community_id,
            normalize_text(payload.get("disaster_type"), "disaster_type"),
            normalize_text(payload.get("description"), "description"),
            normalize_severity(payload.get("severity_level")),
            normalize_date(payload.get("date_occurred"), "date_occurred"),
            item_id,
        ),
    )


def delete_disaster(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "disasters", item_id)
    connection.execute("DELETE FROM disasters WHERE id = ?", (item_id,))


def create_announcement(connection: sqlite3.Connection, payload: dict) -> None:
    disaster_id = normalize_id(payload.get("disaster_id"), "disaster_id")
    require_record(connection, "disasters", disaster_id)
    connection.execute(
        """
        INSERT INTO announcements (disaster_id, title, message, alert_level, date_issued)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            disaster_id,
            normalize_text(payload.get("title"), "title"),
            normalize_text(payload.get("message"), "message"),
            normalize_alert_level(payload.get("alert_level")),
            normalize_date(payload.get("date_issued"), "date_issued"),
        ),
    )


def update_announcement(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "announcements", item_id)
    disaster_id = normalize_id(payload.get("disaster_id"), "disaster_id")
    require_record(connection, "disasters", disaster_id)
    connection.execute(
        """
        UPDATE announcements
        SET disaster_id = ?, title = ?, message = ?, alert_level = ?, date_issued = ?
        WHERE id = ?
        """,
        (
            disaster_id,
            normalize_text(payload.get("title"), "title"),
            normalize_text(payload.get("message"), "message"),
            normalize_alert_level(payload.get("alert_level")),
            normalize_date(payload.get("date_issued"), "date_issued"),
            item_id,
        ),
    )


def delete_announcement(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "announcements", item_id)
    connection.execute("DELETE FROM announcements WHERE id = ?", (item_id,))


def create_center(connection: sqlite3.Connection, payload: dict) -> None:
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)
    center_contacts = normalize_center_contacts(payload.get("center_contacts"))

    center_id = connection.execute(
        """
        INSERT INTO evacuation_centers (community_id, center_name, location, capacity)
        VALUES (?, ?, ?, ?)
        """,
        (
            community_id,
            normalize_text(payload.get("center_name"), "center_name"),
            normalize_text(payload.get("location"), "location"),
            normalize_int(payload.get("capacity"), "capacity"),
        ),
    ).lastrowid
    connection.executemany(
        """
        INSERT INTO center_contacts (center_id, contact_name, phone_number)
        VALUES (?, ?, ?)
        """,
        [(center_id, item["contact_name"], item["phone_number"]) for item in center_contacts],
    )


def update_center(connection: sqlite3.Connection, item_id: int, payload: dict) -> None:
    require_record(connection, "evacuation_centers", item_id)
    community_id = normalize_id(payload.get("community_id"), "community_id")
    require_record(connection, "communities", community_id)
    center_contacts = normalize_center_contacts(payload.get("center_contacts"))
    connection.execute(
        """
        UPDATE evacuation_centers
        SET community_id = ?, center_name = ?, location = ?, capacity = ?
        WHERE id = ?
        """,
        (
            community_id,
            normalize_text(payload.get("center_name"), "center_name"),
            normalize_text(payload.get("location"), "location"),
            normalize_int(payload.get("capacity"), "capacity"),
            item_id,
        ),
    )
    connection.execute("DELETE FROM center_contacts WHERE center_id = ?", (item_id,))
    connection.executemany(
        """
        INSERT INTO center_contacts (center_id, contact_name, phone_number)
        VALUES (?, ?, ?)
        """,
        [(item_id, item["contact_name"], item["phone_number"]) for item in center_contacts],
    )


def delete_center(connection: sqlite3.Connection, item_id: int) -> None:
    require_record(connection, "evacuation_centers", item_id)
    connection.execute("DELETE FROM evacuation_centers WHERE id = ?", (item_id,))


class AppHandler(BaseHTTPRequestHandler):
    server_version = "CommunityDisasterPrototype/1.0"

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self.dispatch("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self.dispatch("DELETE")

    def log_message(self, format: str, *args) -> None:
        return

    def dispatch(self, method: str) -> None:
        parsed_url = urlparse(self.path)
        try:
            if parsed_url.path == "/" or parsed_url.path == "/index.html":
                self.serve_file(TEMPLATES_DIR / "index.html")
                return
            if parsed_url.path.startswith("/static/"):
                self.serve_static(parsed_url.path)
                return
            if parsed_url.path.startswith("/api/"):
                self.handle_api(method, parsed_url.path)
                return
            self.send_json(404, {"error": "Not found."})
        except ApiError as error:
            self.send_json(error.status_code, {"error": error.message})
        except sqlite3.IntegrityError as error:
            message = str(error).lower()
            if "users.username" in message or "unique constraint failed: users.username" in message:
                self.send_json(400, {"error": "Username is already in use."})
                return
            if "users.email" in message or "unique constraint failed: users.email" in message:
                self.send_json(400, {"error": "Email is already in use."})
                return
            if "foreign key constraint failed" in message:
                self.send_json(400, {"error": "This record is linked to other data and cannot be deleted yet."})
                return
            if "unique constraint failed: communities.community_name" in message:
                self.send_json(400, {"error": "That community already exists."})
                return
            self.send_json(400, {"error": "The request could not be completed because of a database constraint."})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Request body must be valid JSON."})
        except Exception as error:  # pragma: no cover
            self.send_json(500, {"error": f"Unexpected server error: {error}"})

    def serve_static(self, request_path: str) -> None:
        relative_path = request_path.replace("/static/", "", 1)
        target = (STATIC_DIR / relative_path).resolve()
        try:
            target.relative_to(STATIC_DIR.resolve())
        except ValueError as error:
            raise ApiError(403, "Forbidden path.") from error
        self.serve_file(target)

    def serve_file(self, target: Path) -> None:
        if not target.exists() or not target.is_file():
            raise ApiError(404, "File not found.")
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def parse_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw_body = self.rfile.read(length)
        if not raw_body:
            return {}
        payload = json.loads(raw_body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ApiError(400, "JSON request body must be an object.")
        return payload

    def parse_session_token(self) -> str | None:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        jar = cookies.SimpleCookie()
        jar.load(cookie_header)
        morsel = jar.get("session_token")
        return morsel.value if morsel else None

    def get_current_user(self) -> dict | None:
        token = self.parse_session_token()
        if not token:
            return None
        with SESSION_LOCK:
            user_id = SESSIONS.get(token)
        if not user_id:
            return None
        with get_connection() as connection:
            return fetch_current_user(connection, user_id)

    def require_current_user(self) -> dict:
        user = self.get_current_user()
        if user is None:
            raise ApiError(401, "Please log in to continue.")
        return user

    def ensure_write_access(self, current_user: dict, resource: str) -> None:
        if current_user["role"] not in ROLE_CHOICES:
            raise ApiError(403, "Only Admin and Officer accounts can manage records.")
        if resource in {"communities", "users"} and current_user["role"] != "Admin":
            raise ApiError(403, "Only administrators can manage communities and users.")

    def handle_api(self, method: str, path: str) -> None:
        if path == "/api/login" and method == "POST":
            self.handle_login(self.parse_json_body())
            return

        if path == "/api/logout" and method == "POST":
            self.handle_logout()
            return

        current_user = self.require_current_user()

        with get_connection() as connection:
            if path == "/api/session" and method == "GET":
                self.send_json(200, {"user": current_user})
                return

            if path == "/api/dashboard" and method == "GET":
                self.send_json(200, fetch_dashboard(connection))
                return

            if path == "/api/lookups" and method == "GET":
                self.send_json(200, fetch_lookups(connection))
                return

            if path == "/api/export" and method == "GET":
                body = json.dumps(generate_export(connection), indent=2).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="community-disaster-export.json"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            resource_path = path.replace("/api/", "", 1).strip("/")
            parts = resource_path.split("/")
            resource = parts[0]
            item_id = None
            if len(parts) == 2:
                try:
                    item_id = int(parts[1])
                except ValueError as error:
                    raise ApiError(404, "Record not found.") from error
            if len(parts) > 2:
                raise ApiError(404, "Record not found.")

            list_map = {
                "communities": fetch_communities,
                "users": fetch_users,
                "organizations": fetch_organizations,
                "emergency-contacts": fetch_contacts,
                "disasters": fetch_disasters,
                "announcements": lambda conn: [
                    announcement
                    for disaster in fetch_disasters(conn)
                    for announcement in disaster["announcements"]
                ],
                "evacuation-centers": fetch_centers,
            }
            create_map = {
                "communities": create_community,
                "users": create_user,
                "organizations": create_organization,
                "emergency-contacts": create_contact,
                "disasters": create_disaster,
                "announcements": create_announcement,
                "evacuation-centers": create_center,
            }
            update_map = {
                "communities": update_community,
                "users": update_user,
                "organizations": update_organization,
                "emergency-contacts": update_contact,
                "disasters": update_disaster,
                "announcements": update_announcement,
                "evacuation-centers": update_center,
            }
            delete_map = {
                "communities": delete_community,
                "users": delete_user,
                "organizations": delete_organization,
                "emergency-contacts": delete_contact,
                "disasters": delete_disaster,
                "announcements": delete_announcement,
                "evacuation-centers": delete_center,
            }

            if resource not in list_map:
                raise ApiError(404, "Resource not found.")

            if method == "GET" and item_id is None:
                self.send_json(200, list_map[resource](connection))
                return

            if method == "POST" and item_id is None:
                self.ensure_write_access(current_user, resource if resource in {"communities", "users"} else "data")
                create_map[resource](connection, self.parse_json_body())
                connection.commit()
                self.send_json(201, {"message": "Record created successfully."})
                return

            if method == "PUT" and item_id is not None:
                self.ensure_write_access(current_user, resource if resource in {"communities", "users"} else "data")
                update_map[resource](connection, item_id, self.parse_json_body())
                connection.commit()
                self.send_json(200, {"message": "Record updated successfully."})
                return

            if method == "DELETE" and item_id is not None:
                self.ensure_write_access(current_user, resource if resource in {"communities", "users"} else "data")
                if resource == "users":
                    delete_map[resource](connection, item_id, current_user["id"])
                else:
                    delete_map[resource](connection, item_id)
                connection.commit()
                self.send_json(200, {"message": "Record deleted successfully."})
                return

        raise ApiError(405, "Method not allowed for this resource.")

    def handle_login(self, payload: dict) -> None:
        username = normalize_text(payload.get("username"), "username")
        password = normalize_text(payload.get("password"), "password")
        with get_connection() as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE username = ? AND password_hash = ?",
                (username, hash_password(password)),
            ).fetchone()
            if row is None:
                raise ApiError(401, "Invalid username or password.")

            token = secrets.token_hex(24)
            with SESSION_LOCK:
                SESSIONS[token] = row["id"]
            user = fetch_current_user(connection, row["id"])

        body = json.dumps({"message": "Logged in successfully.", "user": user}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"session_token={token}; HttpOnly; Path=/; SameSite=Lax")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_logout(self) -> None:
        token = self.parse_session_token()
        if token:
            with SESSION_LOCK:
                SESSIONS.pop(token, None)

        body = json.dumps({"message": "Logged out successfully."}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", "session_token=; Max-Age=0; Path=/; SameSite=Lax")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Community Disaster Information System running at http://{HOST}:{PORT}")
    print("Demo accounts:")
    print("  admin / admin123")
    print("  officer / officer123")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
