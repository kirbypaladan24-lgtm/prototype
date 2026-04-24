const state = {
  user: null,
  lookups: null,
  dashboard: null,
  communities: [],
  users: [],
  organizations: [],
  contacts: [],
  disasters: [],
  centers: [],
  filters: {
    communities: "",
    users: "",
    organizations: "",
    contacts: "",
    disasters: "",
    centers: "",
  },
  activeSection: localStorage.getItem("cdiecs-active-section") || "dashboard",
};

const elements = {};
const STORAGE_KEY = "cdiecs-local-db-v1";
const SESSION_KEY = "cdiecs-local-session-v1";
const ARCHIVE_SEED_VERSION = 1;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindStaticEvents();
  applySection(state.activeSection);
  const lastUsername = localStorage.getItem("cdiecs-last-username");
  if (lastUsername) {
    elements.loginUsername.value = lastUsername;
  }
  checkSession();
});

function cacheElements() {
  elements.loginView = document.getElementById("login-view");
  elements.appShell = document.getElementById("app-shell");
  elements.loginForm = document.getElementById("login-form");
  elements.loginUsername = document.getElementById("login-username");
  elements.loginPassword = document.getElementById("login-password");
  elements.closeLoginButton = document.getElementById("close-login-btn");
  elements.adminLoginButton = document.getElementById("admin-login-btn");
  elements.logoutButton = document.getElementById("logout-btn");
  elements.exportButton = document.getElementById("export-btn");
  elements.exportTxtButton = document.getElementById("export-txt-btn");
  elements.exportErdButton = document.getElementById("export-erd-btn");
  elements.userName = document.getElementById("user-name");
  elements.userRole = document.getElementById("user-role");
  elements.toast = document.getElementById("toast");
  elements.modalOverlay = document.getElementById("modal-overlay");
  elements.navButtons = Array.from(document.querySelectorAll(".nav-btn"));
  elements.sectionButtons = {
    community: document.getElementById("add-community-btn"),
    user: document.getElementById("add-user-btn"),
    organization: document.getElementById("add-organization-btn"),
    contact: document.getElementById("add-contact-btn"),
    disaster: document.getElementById("add-disaster-btn"),
    center: document.getElementById("add-center-btn"),
  };
  elements.searchInputs = {
    communities: document.getElementById("communities-search"),
    users: document.getElementById("users-search"),
    organizations: document.getElementById("organizations-search"),
    contacts: document.getElementById("contacts-search"),
    disasters: document.getElementById("disasters-search"),
    centers: document.getElementById("centers-search"),
  };
  elements.content = {
    dashboard: document.getElementById("dashboard-content"),
    communities: document.getElementById("communities-content"),
    users: document.getElementById("users-content"),
    organizations: document.getElementById("organizations-content"),
    contacts: document.getElementById("contacts-content"),
    disasters: document.getElementById("disasters-content"),
    centers: document.getElementById("centers-content"),
  };
}

function bindStaticEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.closeLoginButton.addEventListener("click", closeLoginOverlay);
  elements.adminLoginButton.addEventListener("click", openLoginOverlay);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.exportButton.addEventListener("click", handleExport);
  elements.exportTxtButton.addEventListener("click", handleTextExport);
  elements.exportErdButton.addEventListener("click", handleErdTextExport);

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applySection(button.dataset.sectionTarget);
    });
  });

  elements.sectionButtons.community.addEventListener("click", () => openCommunityModal());
  elements.sectionButtons.user.addEventListener("click", () => openUserModal());
  elements.sectionButtons.organization.addEventListener("click", () => openOrganizationModal());
  elements.sectionButtons.contact.addEventListener("click", () => openContactModal());
  elements.sectionButtons.disaster.addEventListener("click", () => openDisasterModal());
  elements.sectionButtons.center.addEventListener("click", () => openCenterModal());

  Object.entries(elements.searchInputs).forEach(([key, input]) => {
    input.addEventListener("input", (event) => {
      state.filters[key] = event.target.value.trim().toLowerCase();
      renderSection(key);
    });
  });

  document.body.addEventListener("click", handleDelegatedActions);
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const normalizedPath = String(path).replace(/^https?:\/\/[^/]+/i, "");
  let payload = {};

  if (typeof options.body === "string" && options.body.trim()) {
    payload = JSON.parse(options.body);
  } else if (options.body && typeof options.body === "object") {
    payload = options.body;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  try {
    return handleLocalApi(loadDatabase(), method, normalizedPath, payload);
  } catch (error) {
    const wrapped = new Error(error.message || "Request failed.");
    wrapped.status = error.status || 500;
    throw wrapped;
  }
}

async function checkSession() {
  try {
    const payload = await api("/api/session");
    state.user = payload.user;
    showApp();
    await loadAllData();
  } catch (error) {
    state.user = null;
    showApp();
    await loadAllData();
    if (error.status && error.status !== 401) {
      showToast(error.message, "error");
    }
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value.trim();

  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem("cdiecs-last-username", username);
    state.user = payload.user;
    elements.loginPassword.value = "";
    closeLoginOverlay();
    await loadAllData();
    applySection("dashboard");
    showToast("Admin panel opened.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleLogout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.user = null;
    closeModal();
    closeLoginOverlay();
    if (state.activeSection === "users") {
      applySection("dashboard");
    }
    await loadAllData();
    showToast("Returned to public view.", "success");
  }
}

async function handleExport() {
  try {
    if (!hasManageAccess()) {
      throw new Error("Export is available from the admin panel only.");
    }
    const exportData = buildExportData(loadDatabase());
    downloadExportFile("community-disaster-export.json", JSON.stringify(exportData, null, 2), "application/json");
    showToast("Export downloaded.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleTextExport() {
  try {
    if (!hasManageAccess()) {
      throw new Error("Export is available from the admin panel only.");
    }
    const exportData = buildExportData(loadDatabase());
    const textDump = buildTextExport(exportData);
    downloadExportFile("community-disaster-database.txt", textDump, "text/plain;charset=utf-8");
    showToast("TXT export downloaded.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleErdTextExport() {
  try {
    if (!hasManageAccess()) {
      throw new Error("Export is available from the admin panel only.");
    }
    const erdText = buildErdTextExport();
    downloadExportFile("community-disaster-erd.txt", erdText, "text/plain;charset=utf-8");
    showToast("ERD TXT exported.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadAllData() {
  try {
    const [dashboard, lookups, communities, organizations, contacts, disasters, centers] = await Promise.all([
      api("/api/dashboard"),
      api("/api/lookups"),
      api("/api/communities"),
      api("/api/organizations"),
      api("/api/emergency-contacts"),
      api("/api/disasters"),
      api("/api/evacuation-centers"),
    ]);

    const users = hasManageAccess() ? await api("/api/users") : [];

    state.dashboard = dashboard;
    state.lookups = lookups;
    state.communities = communities;
    state.users = users;
    state.organizations = organizations;
    state.contacts = contacts;
    state.disasters = disasters;
    state.centers = centers;

    renderChrome();
    renderAllSections();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    showToast(error.message, "error");
  }
}

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashPassword(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `p${(hash >>> 0).toString(16)}`;
}

function archivedTyphoonRecord({
  communityId = 1,
  disasterType,
  dateOccurred,
  severityLevel,
  summary,
  alertLevel = "Warning",
  announcementTitle,
  announcementMessage,
}) {
  return {
    disaster: {
      community_id: communityId,
      disaster_type: disasterType,
      description: summary,
      severity_level: severityLevel,
      date_occurred: dateOccurred,
    },
    announcements: [
      {
        title: announcementTitle || `Archived Record: ${disasterType}`,
        message:
          announcementMessage ||
          `Historical seed entry for ${disasterType} on ${dateOccurred}. Stored as archived storm data for the prototype.`,
        alert_level: alertLevel,
        date_issued: dateOccurred,
      },
    ],
  };
}

function historicalBicolTyphoonSeed(communityId = 1) {
  return [
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Jean (1947)",
      dateOccurred: "1947-12-25",
      severityLevel: "Critical",
      summary:
        "Christmas-period archival typhoon that made landfall near the Albay-Camarines Sur border and crossed southern Luzon, making it one of the older historically noted Bicol-impact storms.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Jean in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Fran (1950)",
      dateOccurred: "1950-12-27",
      severityLevel: "Moderate",
      summary:
        "Late-season archival storm from 27 December 1950 to 1 January 1951. Available references place its strongest Philippine effects in the northern Philippines, so this entry is kept as a broader archive reference from the requested list.",
      alertLevel: "Advisory",
      announcementTitle: "Archived Record: Fran Reference Entry",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Konsing (Ora)",
      dateOccurred: "1972-06-25",
      severityLevel: "High",
      summary:
        "June 1972 typhoon that crossed Luzon and caused destructive flooding. Archival reports also mention casualties near Rapu-Rapu, Albay, linking the event to the Bicol storm archive.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Konsing in the Bicol Archive",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Bebeng (Vera)",
      dateOccurred: "1983-07-15",
      severityLevel: "High",
      summary:
        "Mid-July 1983 typhoon that crossed the central Philippines. Contemporary reports noted severe damage in Legazpi, Albay and casualties in Sorsogon, making it a valid Bicol-region archive entry.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Bebeng in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Saling (Dan)",
      dateOccurred: "1989-10-10",
      severityLevel: "High",
      summary:
        "October 1989 typhoon that made landfall along southeastern Luzon before crossing the island. It is included as a southeastern Luzon and Bicol-facing archive storm from the historical list.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Saling in Southern Luzon",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Unding (Muifa)",
      dateOccurred: "2004-11-19",
      severityLevel: "Critical",
      summary:
        "November 2004 typhoon with a looping track east of Luzon before crossing northern Bicol near Naga City. It brought destructive winds and rain to Camarines Sur and nearby provinces.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Unding in Northern Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Super Typhoon Reming (Durian)",
      dateOccurred: "2006-11-30",
      severityLevel: "Critical",
      summary:
        "Archived Bicol-region record based on official PAGASA and NDRRMC references. Reming brought destructive winds and intense rainfall that heavily affected Albay and nearby provinces in Region V.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Reming in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Glenda (Rammasun)",
      dateOccurred: "2014-07-15",
      severityLevel: "High",
      summary:
        "July 2014 typhoon that made landfall over Albay and crossed the Bicol Region toward Southern Luzon. Reports placed Legazpi, Albay near the track and noted heavy impacts across Bicol.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Glenda in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Nina (Nock-ten)",
      dateOccurred: "2016-12-25",
      severityLevel: "Critical",
      summary:
        "Archived Bicol-region record based on official NDRRMC situation reports. Typhoon Nina made landfall in Bato, Catanduanes and brought damaging winds and rain across Region V during Christmas 2016.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Nina in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Tisoy (Kammuri)",
      dateOccurred: "2019-12-02",
      severityLevel: "High",
      summary:
        "Archived Bicol-region record based on PAGASA tropical cyclone reporting. Tisoy made landfall in Gubat, Sorsogon and affected several Bicol provinces with destructive winds, heavy rain, and storm surge threats.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Tisoy in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Quinta (Molave)",
      dateOccurred: "2020-10-25",
      severityLevel: "High",
      summary:
        "Archived Bicol-region record based on PAGASA tropical cyclone reporting. Quinta made landfall over San Miguel Island, Tabaco City, Albay and produced heavy rain and strong winds across parts of Region V.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Quinta in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Super Typhoon Rolly (Goni)",
      dateOccurred: "2020-11-01",
      severityLevel: "Critical",
      summary:
        "Archived Bicol-region record based on official PAGASA and NDRRMC references. Rolly made landfall in Bato, Catanduanes before crossing Albay and was one of the strongest typhoons to affect Bicol.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Rolly in Bicol",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Kristine (Trami)",
      dateOccurred: "2024-10-22",
      severityLevel: "High",
      summary:
        "October 2024 typhoon whose displaced rainbands and monsoon interaction produced torrential rainfall over Bicol. PAGASA recorded major storm-duration rainfall in Daet, Juban, and Legazpi during Kristine.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Kristine Rainfall Event",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Super Typhoon Pepito (Man-yi)",
      dateOccurred: "2024-11-16",
      severityLevel: "Critical",
      summary:
        "November 2024 super typhoon that made landfall in Panganiban, Catanduanes before crossing Aurora. It is one of the strongest recent direct Bicol-impact storms in the archive.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Pepito in Catanduanes",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Super Typhoon Nando (Ragasa)",
      dateOccurred: "2025-09-17",
      severityLevel: "Critical",
      summary:
        "September 2025 super typhoon from the requested archive list. Official PAGASA reporting places its Philippine landfall in Calayan, Cagayan, so this is stored as a broader reference storm rather than a direct Bicol landfall entry.",
      alertLevel: "Advisory",
      announcementTitle: "Archived Record: Nando Reference Entry",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Typhoon Opong (Bualoi)",
      dateOccurred: "2025-09-25",
      severityLevel: "High",
      summary:
        "Typhoon Opong occurred from 23 to 29 September 2025 and made landfall in Eastern Samar and Masbate. Because Masbate is part of Region V, it belongs in the Bicol-facing archive set.",
      alertLevel: "Warning",
      announcementTitle: "Archived Record: Opong in Masbate",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Super Typhoon Uwan (Fung-Wong)",
      dateOccurred: "2025-11-09",
      severityLevel: "Critical",
      summary:
        "Official PAGASA reporting lists UWAN from 3 to 13 November 2025, with landfall in Dinalungan, Aurora on 9 November. Catanduanes and Camarines Norte still recorded major rainfall and peak gusts during the event.",
      alertLevel: "Emergency",
      announcementTitle: "Archived Record: Uwan Regional Impact",
    }),
    archivedTyphoonRecord({
      communityId,
      disasterType: "Tropical Storm Ada (Nokaen)",
      dateOccurred: "2026-01-14",
      severityLevel: "Moderate",
      summary:
        "Official PAGASA reporting classifies ADA as a tropical storm from 14 to 22 January 2026. The storm stayed offshore east of Catanduanes, so it is included as a recent Bicol-facing reference event rather than a direct landfall typhoon.",
      alertLevel: "Advisory",
      announcementTitle: "Archived Record: Ada East of Catanduanes",
    }),
  ];
}

function ensureDatabaseMeta(database) {
  let changed = false;
  if (!database._meta || typeof database._meta !== "object" || Array.isArray(database._meta)) {
    database._meta = {};
    changed = true;
  }
  if (!Object.prototype.hasOwnProperty.call(database._meta, "last_updated_at")) {
    database._meta.last_updated_at = null;
    changed = true;
  }
  if (!Object.prototype.hasOwnProperty.call(database._meta, "last_updated_by")) {
    database._meta.last_updated_by = null;
    changed = true;
  }
  return changed;
}

function getLegacySeedDisasterIds(database, communityId = 1) {
  return new Set(
    database.disasters
      .filter(
        (item) =>
          item.community_id === communityId &&
          ((item.disaster_type === "Typhoon" &&
            item.date_occurred === "2026-03-18" &&
            item.description ===
              "Heavy rainfall caused road flooding near the riverbanks and interrupted transport.") ||
            (item.disaster_type === "Flood" &&
              item.date_occurred === "2026-04-02" &&
              item.description ===
                "Overflowing drainage affected low-lying puroks and triggered precautionary evacuation."))
      )
      .map((item) => item.id)
  );
}

function applyHistoricalBicolTyphoonSeed(database, communityId = 1) {
  let changed = false;
  historicalBicolTyphoonSeed(communityId).forEach((entry) => {
    let disaster = database.disasters.find(
      (item) =>
        item.community_id === entry.disaster.community_id &&
        item.date_occurred === entry.disaster.date_occurred &&
        item.disaster_type.toLowerCase() === entry.disaster.disaster_type.toLowerCase()
    );

    if (!disaster) {
      disaster = {
        id: nextId(database.disasters),
        ...cloneData(entry.disaster),
      };
      database.disasters.push(disaster);
      changed = true;
    }

    entry.announcements.forEach((announcementSeed) => {
      const hasAnnouncement = database.announcements.some(
        (item) =>
          item.disaster_id === disaster.id &&
          item.title === announcementSeed.title &&
          item.date_issued === announcementSeed.date_issued
      );

      if (!hasAnnouncement) {
        database.announcements.push({
          id: nextId(database.announcements),
          disaster_id: disaster.id,
          ...cloneData(announcementSeed),
        });
        changed = true;
      }
    });
  });

  return changed;
}

function migrateHistoricalBicolTyphoonSeed(database, communityId = 1) {
  let changed = ensureDatabaseMeta(database);
  const currentVersion = Number(database._meta.archived_typhoon_seed_version || 0);

  if (currentVersion >= ARCHIVE_SEED_VERSION) {
    return changed;
  }

  const legacySeedDisasterIds = getLegacySeedDisasterIds(database, communityId);
  if (legacySeedDisasterIds.size > 0) {
    database.announcements = database.announcements.filter((item) => !legacySeedDisasterIds.has(item.disaster_id));
    database.disasters = database.disasters.filter((item) => !legacySeedDisasterIds.has(item.id));
    changed = true;
    if (applyHistoricalBicolTyphoonSeed(database, communityId)) {
      changed = true;
    }
  }

  database._meta.archived_typhoon_seed_version = ARCHIVE_SEED_VERSION;
  return true;
}

function removeUnsupportedResidentUsers(database) {
  const originalLength = database.users.length;
  database.users = database.users.filter((user) => user.role !== "Resident");
  if (database.users.length === originalLength) {
    return false;
  }

  const sessionUserId = getSessionUserId();
  if (sessionUserId && !database.users.some((user) => user.id === sessionUserId)) {
    clearSessionUser();
  }
  return true;
}

function buildSeedDatabase() {
  const database = {
    _meta: {
      archived_typhoon_seed_version: ARCHIVE_SEED_VERSION,
      last_updated_at: null,
      last_updated_by: null,
    },
    communities: [
      {
        id: 1,
        community_name: "San Isidro Resilience Hub",
        barangay: "Salvacion",
        city: "Goa",
        province: "Camarines Sur",
        population: 2840,
      },
    ],
    users: [
      {
        id: 1,
        community_id: 1,
        full_name: "Ayesa P. Alerta",
        username: "admin",
        password_hash: hashPassword("admin123"),
        role: "Admin",
        email: "admin@sanisidro.local",
      },
      {
        id: 2,
        community_id: 1,
        full_name: "Jovert A. Pabon",
        username: "officer",
        password_hash: hashPassword("officer123"),
        role: "Officer",
        email: "officer@sanisidro.local",
      },
    ],
    organizations: [
      { id: 1, organization_name: "Partido MDRRMO", type: "Government" },
      { id: 2, organization_name: "Goa Rural Health Unit", type: "Health" },
      { id: 3, organization_name: "Bureau of Fire Protection - Goa", type: "Fire and Rescue" },
      { id: 4, organization_name: "Philippine National Police - Goa", type: "Police" },
    ],
    emergency_contacts: [
      {
        id: 1,
        organization_id: 1,
        community_id: 1,
        name: "Kirby H. Paladan",
        role: "Municipal DRRM Officer",
        email: "mdrrmo@goa.local",
      },
      {
        id: 2,
        organization_id: 2,
        community_id: 1,
        name: "Nurse Maria Santos",
        role: "Emergency Health Coordinator",
        email: "rhu@goa.local",
      },
      {
        id: 3,
        organization_id: 3,
        community_id: 1,
        name: "FO2 Daniel Cruz",
        role: "Fire Marshal",
        email: "bfp@goa.local",
      },
    ],
    contact_numbers: [
      { id: 1, contact_id: 1, phone_number: "09171234567", network: "Globe" },
      { id: 2, contact_id: 1, phone_number: "09981234567", network: "Smart" },
      { id: 3, contact_id: 2, phone_number: "09192345678", network: "DITO" },
      { id: 4, contact_id: 3, phone_number: "09283456789", network: "Globe" },
    ],
    disasters: [],
    announcements: [],
    evacuation_centers: [
      {
        id: 1,
        community_id: 1,
        center_name: "San Isidro Covered Court",
        location: "Zone 2, near Barangay Hall",
        capacity: 350,
      },
      {
        id: 2,
        community_id: 1,
        center_name: "Partido State University Gym",
        location: "Main campus compound, Goa",
        capacity: 500,
      },
    ],
    center_contacts: [
      { id: 1, center_id: 1, contact_name: "Barangay Captain Elena Ramos", phone_number: "09174567890" },
      { id: 2, center_id: 1, contact_name: "Logistics Volunteer Desk", phone_number: "09294567890" },
    ],
  };

  applyHistoricalBicolTyphoonSeed(database);
  return database;
}

function loadDatabase() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = buildSeedDatabase();
    saveDatabase(seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(stored);
    const requiredKeys = [
      "communities",
      "users",
      "organizations",
      "emergency_contacts",
      "contact_numbers",
      "disasters",
      "announcements",
      "evacuation_centers",
      "center_contacts",
    ];
    if (!requiredKeys.every((key) => Array.isArray(parsed[key]))) {
      throw new Error("Storage shape mismatch");
    }
    const migratedSeed = migrateHistoricalBicolTyphoonSeed(parsed);
    const removedUnsupportedUsers = removeUnsupportedResidentUsers(parsed);
    if (migratedSeed || removedUnsupportedUsers) {
      saveDatabase(parsed);
    }
    return parsed;
  } catch (error) {
    const seeded = buildSeedDatabase();
    saveDatabase(seeded);
    return seeded;
  }
}

function saveDatabase(database) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}

function getSessionUserId() {
  const raw = localStorage.getItem(SESSION_KEY);
  const parsed = Number(raw || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function setSessionUserId(userId) {
  localStorage.setItem(SESSION_KEY, String(userId));
}

function clearSessionUser() {
  localStorage.removeItem(SESSION_KEY);
}

function normalizeText(value, fieldName) {
  if (typeof value !== "string") {
    throw makeError(`${fieldName} must be a text value.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw makeError(`${fieldName} is required.`);
  }
  return cleaned;
}

function normalizeEmail(value, fieldName = "email") {
  const email = normalizeText(value, fieldName).toLowerCase();
  if (!email.includes("@") || !email.split("@").pop().includes(".")) {
    throw makeError(`${fieldName} must be a valid email address.`);
  }
  return email;
}

function normalizeInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw makeError(`${fieldName} must be a whole number.`);
  }
  if (parsed < 0) {
    throw makeError(`${fieldName} must not be negative.`);
  }
  return parsed;
}

function normalizeId(value, fieldName) {
  const parsed = normalizeInt(value, fieldName);
  if (parsed <= 0) {
    throw makeError(`${fieldName} must be a valid identifier.`);
  }
  return parsed;
}

function normalizeDate(value, fieldName) {
  const dateText = normalizeText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw makeError(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw makeError(`${fieldName} must be a valid date.`);
  }
  return dateText;
}

function normalizeRole(value) {
  const role = normalizeText(value, "role");
  if (!["Admin", "Officer"].includes(role)) {
    throw makeError("role must be one of: Admin, Officer.");
  }
  return role;
}

function normalizeSeverity(value) {
  const severity = normalizeText(value, "severity_level");
  if (!["Low", "Moderate", "High", "Critical"].includes(severity)) {
    throw makeError("severity_level must be one of: Low, Moderate, High, Critical.");
  }
  return severity;
}

function normalizeAlertLevel(value) {
  const alertLevel = normalizeText(value, "alert_level");
  if (!["Advisory", "Watch", "Warning", "Emergency"].includes(alertLevel)) {
    throw makeError("alert_level must be one of: Advisory, Watch, Warning, Emergency.");
  }
  return alertLevel;
}

function normalizePhoneNumber(value, fieldName, options = {}) {
  const cleaned = normalizeText(value, fieldName).replace(/[\s()-]/g, "");
  const allowLandline = Boolean(options.allowLandline);

  if (/^09\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^\+639\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^639\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (allowLandline && /^\d{7,10}$/.test(cleaned)) {
    return cleaned;
  }

  throw makeError(
    `${fieldName} must be a valid phone number. Use formats like 09171234567 or +639171234567.`
  );
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function getRecord(database, collectionName, itemId, label = collectionName) {
  const record = database[collectionName].find((item) => item.id === itemId);
  if (!record) {
    throw makeError(`${label} not found.`, 404);
  }
  return record;
}

function communityLabelFromRecord(community) {
  return `${community.community_name} - ${community.barangay}, ${community.city}, ${community.province}`;
}

function projectUser(database, user) {
  const community = getRecord(database, "communities", user.community_id, "Community");
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    email: user.email,
    community_id: user.community_id,
    community_name: community.community_name,
    barangay: community.barangay,
    city: community.city,
    province: community.province,
    community_label: communityLabelFromRecord(community),
  };
}

function getProjectedCommunity(database, community) {
  return {
    ...community,
    user_count: database.users.filter((user) => user.community_id === community.id).length,
    contact_count: database.emergency_contacts.filter((contact) => contact.community_id === community.id).length,
    disaster_count: database.disasters.filter((disaster) => disaster.community_id === community.id).length,
    center_count: database.evacuation_centers.filter((center) => center.community_id === community.id).length,
    label: communityLabelFromRecord(community),
  };
}

function buildCommunities(database) {
  return database.communities
    .slice()
    .sort((left, right) =>
      `${left.province}${left.city}${left.barangay}${left.community_name}`.localeCompare(
        `${right.province}${right.city}${right.barangay}${right.community_name}`
      )
    )
    .map((community) => getProjectedCommunity(database, community));
}

function buildUsers(database) {
  const roleOrder = { Admin: 1, Officer: 2 };
  return database.users
    .slice()
    .sort((left, right) => {
      const roleDiff = roleOrder[left.role] - roleOrder[right.role];
      return roleDiff || left.full_name.localeCompare(right.full_name);
    })
    .map((user) => projectUser(database, user));
}

function buildOrganizations(database) {
  return database.organizations
    .slice()
    .sort((left, right) => left.organization_name.localeCompare(right.organization_name))
    .map((organization) => ({
      ...organization,
      contact_count: database.emergency_contacts.filter((contact) => contact.organization_id === organization.id).length,
    }));
}

function buildContacts(database) {
  return database.emergency_contacts
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((contact) => {
      const organization = getRecord(database, "organizations", contact.organization_id, "Organization");
      const community = getRecord(database, "communities", contact.community_id, "Community");
      const phoneNumbers = database.contact_numbers
        .filter((item) => item.contact_id === contact.id)
        .sort((left, right) => left.id - right.id)
        .map((item) => ({ ...item }));
      return {
        ...contact,
        organization_name: organization.organization_name,
        organization_type: organization.type,
        community_name: community.community_name,
        barangay: community.barangay,
        city: community.city,
        province: community.province,
        community_label: communityLabelFromRecord(community),
        phone_numbers: phoneNumbers,
      };
    });
}

function buildAnnouncements(database) {
  return database.announcements
    .slice()
    .sort((left, right) => `${right.date_issued}${right.id}`.localeCompare(`${left.date_issued}${left.id}`))
    .map((announcement) => ({ ...announcement }));
}

function buildDisasters(database) {
  return database.disasters
    .slice()
    .sort((left, right) => `${right.date_occurred}${right.id}`.localeCompare(`${left.date_occurred}${left.id}`))
    .map((disaster) => {
      const community = getRecord(database, "communities", disaster.community_id, "Community");
      const announcements = database.announcements
        .filter((announcement) => announcement.disaster_id === disaster.id)
        .slice()
        .sort((left, right) => `${right.date_issued}${right.id}`.localeCompare(`${left.date_issued}${left.id}`))
        .map((announcement) => ({ ...announcement }));
      return {
        ...disaster,
        community_name: community.community_name,
        barangay: community.barangay,
        city: community.city,
        province: community.province,
        community_label: communityLabelFromRecord(community),
        announcements,
      };
    });
}

function buildCenters(database) {
  return database.evacuation_centers
    .slice()
    .sort((left, right) => left.center_name.localeCompare(right.center_name))
    .map((center) => {
      const community = getRecord(database, "communities", center.community_id, "Community");
      const centerContacts = database.center_contacts
        .filter((contact) => contact.center_id === center.id)
        .sort((left, right) => left.id - right.id)
        .map((contact) => ({ ...contact }));
      return {
        ...center,
        community_name: community.community_name,
        barangay: community.barangay,
        city: community.city,
        province: community.province,
        community_label: communityLabelFromRecord(community),
        center_contacts: centerContacts,
      };
    });
}

function summarizeText(value, maxLength = 180) {
  const input = String(value || "").trim().replace(/\s+/g, " ");
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function daysSinceDate(dateText) {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const source = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.floor((current.getTime() - source.getTime()) / 86400000);
}

function classifyAlertTimeliness(dateText) {
  const days = daysSinceDate(dateText);
  if (days <= 7) {
    return { label: "Current", className: "status-current" };
  }
  if (days <= 30) {
    return { label: "Recent", className: "status-recent" };
  }
  return { label: "Archived", className: "status-archived" };
}

function alertLevelWeight(level) {
  return {
    Advisory: 1,
    Watch: 2,
    Warning: 3,
    Emergency: 4,
  }[level] || 0;
}

function alertTimelinessWeight(label) {
  return {
    Current: 3,
    Recent: 2,
    Archived: 1,
  }[label] || 0;
}

function buildLastUpdateInfo(database) {
  const meta = database._meta || {};
  if (!meta.last_updated_at || !meta.last_updated_by) {
    return {
      label: "Seeded local data",
      detail: "No admin changes recorded yet.",
    };
  }

  const user = database.users.find((item) => item.id === meta.last_updated_by);
  return {
    label: user ? user.full_name : "Unknown user",
    detail: new Date(meta.last_updated_at).toLocaleString(),
  };
}

function stampDatabaseUpdate(database, user) {
  ensureDatabaseMeta(database);
  database._meta.last_updated_at = new Date().toISOString();
  database._meta.last_updated_by = user.id;
}

function buildDashboard(database) {
  const communities = buildCommunities(database);
  const users = buildUsers(database);
  const organizations = buildOrganizations(database);
  const contacts = buildContacts(database);
  const disasters = buildDisasters(database);
  const centers = buildCenters(database);
  const recentAnnouncements = buildAnnouncements(database)
    .slice(0, 5)
    .map((announcement) => {
      const disaster = getRecord(database, "disasters", announcement.disaster_id, "Disaster");
      const community = getRecord(database, "communities", disaster.community_id, "Community");
      const timeliness = classifyAlertTimeliness(announcement.date_issued);
      return {
        ...announcement,
        disaster_type: disaster.disaster_type,
        community_name: community.community_name,
        barangay: community.barangay,
        city: community.city,
        province: community.province,
        community_label: communityLabelFromRecord(community),
        timeliness_label: timeliness.label,
        timeliness_class: timeliness.className,
      };
    });
  const highlightedAlert =
    recentAnnouncements
      .slice()
      .sort((left, right) => {
        const timeRank = alertTimelinessWeight(right.timeliness_label) - alertTimelinessWeight(left.timeliness_label);
        const levelRank = alertLevelWeight(right.alert_level) - alertLevelWeight(left.alert_level);
        return timeRank || levelRank || `${right.date_issued}${right.id}`.localeCompare(`${left.date_issued}${left.id}`);
      })[0] || null;
  const hotlineContact =
    contacts.find((item) => /drrm|emergency|fire|police|health/i.test(`${item.role} ${item.organization_name}`)) ||
    contacts[0] ||
    null;
  const priorityCenter =
    centers
      .slice()
      .sort((left, right) => right.capacity - left.capacity || left.center_name.localeCompare(right.center_name))[0] || null;
  const locationSummary = {
    barangays: [...new Set(communities.map((item) => item.barangay))].slice(0, 4),
    cities: [...new Set(communities.map((item) => item.city))].slice(0, 4),
    provinces: [...new Set(communities.map((item) => item.province))].slice(0, 4),
  };

  return {
    counts: {
      communities: communities.length,
      users: users.length,
      organizations: organizations.length,
      contacts: contacts.length,
      disasters: disasters.length,
      announcements: database.announcements.length,
      centers: centers.length,
    },
    communities: communities.slice(0, 3),
    contacts: contacts.slice(0, 6),
    disasters: disasters.slice(0, 4),
    recent_announcements: recentAnnouncements,
    quick_reference: {
      highlighted_alert: highlightedAlert,
      hotline_contact: hotlineContact
        ? {
            name: hotlineContact.name,
            role: hotlineContact.role,
            phone: hotlineContact.phone_numbers[0]?.phone_number || "No number",
            network: hotlineContact.phone_numbers[0]?.network || "",
          }
        : null,
      featured_center: priorityCenter
        ? {
            center_name: priorityCenter.center_name,
            location: priorityCenter.location,
            capacity: priorityCenter.capacity,
            community_name: priorityCenter.community_name,
          }
        : null,
      location_summary: locationSummary,
      last_update: buildLastUpdateInfo(database),
    },
    generated_at: new Date().toLocaleString(),
  };
}

function buildLookups(database) {
  const commonDisasterTypes = [
    "Typhoon",
    "Flood",
    "Earthquake",
    "Landslide",
    "Storm Surge",
    "Volcanic Eruption",
    "Tsunami",
    "Drought",
    "Fire",
    "Tropical Storm",
  ];
  const recordedDisasterTypes = buildDisasters(database).map((item) => item.disaster_type);
  const disasterTypes = [...new Set([...commonDisasterTypes, ...recordedDisasterTypes])];

  return {
    communities: buildCommunities(database).map((item) => ({ id: item.id, label: `CommunityID ${item.id} - ${item.label}` })),
    organizations: buildOrganizations(database).map((item) => ({
      id: item.id,
      label: `OrganizationID ${item.id} - ${item.organization_name}`,
      type: item.type,
    })),
    disasters: buildDisasters(database).map((item) => ({
      id: item.id,
      label: `DisasterID ${item.id} - ${item.disaster_type} - ${item.date_occurred} (${item.community_name})`,
    })),
    centers: buildCenters(database).map((item) => ({ id: item.id, label: `CenterID ${item.id} - ${item.center_name}` })),
    roles: ["Admin", "Officer"],
    severity_levels: ["Low", "Moderate", "High", "Critical"],
    alert_levels: ["Advisory", "Watch", "Warning", "Emergency"],
    disaster_types: disasterTypes,
    organization_types: ["Government", "Health", "Fire and Rescue", "Police", "Volunteer Group", "Relief Organization"],
  };
}

function buildExportData(database) {
  return {
    exported_at: new Date().toISOString(),
    communities: buildCommunities(database),
    users: buildUsers(database),
    organizations: buildOrganizations(database),
    emergency_contacts: buildContacts(database),
    disasters: buildDisasters(database),
    evacuation_centers: buildCenters(database),
  };
}

function downloadExportFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildTextExport(exportData) {
  const lines = [
    "COMMUNITY DISASTER INFORMATION AND EMERGENCY CONTACT SYSTEM",
    "LOCAL DATABASE TEXT EXPORT",
    "",
    `Exported At: ${exportData.exported_at}`,
    `Communities: ${exportData.communities.length}`,
    `Users: ${exportData.users.length}`,
    `Organizations: ${exportData.organizations.length}`,
    `Emergency Contacts: ${exportData.emergency_contacts.length}`,
    `Disasters: ${exportData.disasters.length}`,
    `Evacuation Centers: ${exportData.evacuation_centers.length}`,
    "",
    "============================================================",
    "COMMUNITIES",
    "============================================================",
  ];

  exportData.communities.forEach((item) => {
    lines.push(
      `CommunityID: ${item.id}`,
      `Name: ${item.community_name}`,
      `Location: ${item.barangay}, ${item.city}, ${item.province}`,
      `Population: ${item.population}`,
      `Users: ${item.user_count} | Contacts: ${item.contact_count} | Disasters: ${item.disaster_count} | Centers: ${item.center_count}`,
      ""
    );
  });

  lines.push(
    "============================================================",
    "USERS",
    "============================================================"
  );

  exportData.users.forEach((item) => {
    lines.push(
      `UserID: ${item.id}`,
      `Name: ${item.full_name}`,
      `Role: ${item.role}`,
      `Username: ${item.username}`,
      `Email: ${item.email}`,
      `CommunityID: ${item.community_id}`,
      `Community: ${item.community_label}`,
      ""
    );
  });

  lines.push(
    "============================================================",
    "ORGANIZATIONS",
    "============================================================"
  );

  exportData.organizations.forEach((item) => {
    lines.push(
      `OrganizationID: ${item.id}`,
      `Name: ${item.organization_name}`,
      `Type: ${item.type}`,
      `Linked Contacts: ${item.contact_count}`,
      ""
    );
  });

  lines.push(
    "============================================================",
    "EMERGENCY CONTACTS",
    "============================================================"
  );

  exportData.emergency_contacts.forEach((item) => {
    lines.push(
      `ContactID: ${item.id}`,
      `Name: ${item.name}`,
      `Role: ${item.role}`,
      `Email: ${item.email}`,
      `OrganizationID: ${item.organization_id}`,
      `Organization: ${item.organization_name}`,
      `CommunityID: ${item.community_id}`,
      `Community: ${item.community_label}`,
      `Phone Numbers: ${item.phone_numbers
        .map((phone) => `ContactNumberID ${phone.id}; ContactID ${phone.contact_id}; ${phone.network} ${phone.phone_number}`)
        .join(" | ")}`,
      ""
    );
  });

  lines.push(
    "============================================================",
    "DISASTERS AND ANNOUNCEMENTS",
    "============================================================"
  );

  exportData.disasters.forEach((item) => {
    lines.push(
      `DisasterID: ${item.id}`,
      `Type: ${item.disaster_type}`,
      `CommunityID: ${item.community_id}`,
      `Community: ${item.community_label}`,
      `Severity: ${item.severity_level}`,
      `Date Occurred: ${item.date_occurred}`,
      `Description: ${item.description}`,
      `Announcements: ${item.announcements.length}`
    );

    item.announcements.forEach((announcement, index) => {
      lines.push(
        `  ${index + 1}. AnnouncementID ${announcement.id}: ${announcement.title}`,
        `     DisasterID: ${announcement.disaster_id}`,
        `     Alert Level: ${announcement.alert_level}`,
        `     Date Issued: ${announcement.date_issued}`,
        `     Message: ${announcement.message}`
      );
    });

    lines.push("");
  });

  lines.push(
    "============================================================",
    "EVACUATION CENTERS",
    "============================================================"
  );

  exportData.evacuation_centers.forEach((item) => {
    lines.push(
      `CenterID: ${item.id}`,
      `Center: ${item.center_name}`,
      `Location: ${item.location}`,
      `CommunityID: ${item.community_id}`,
      `Community: ${item.community_label}`,
      `Capacity: ${item.capacity}`,
      `Center Contacts: ${item.center_contacts
        .map((contact) => `CenterContactID ${contact.id}; CenterID ${contact.center_id}; ${contact.contact_name} (${contact.phone_number})`)
        .join(" | ")}`,
      ""
    );
  });

  return lines.join("\n");
}

function buildErdTextExport() {
  const today = new Date().toISOString();
  const lines = [
    "COMMUNITY DISASTER INFORMATION AND EMERGENCY CONTACT SYSTEM",
    "ERD TEXT REFERENCE",
    "",
    `Generated At: ${today}`,
    "Purpose: Compare the platform structure with the business-rule ERD.",
    "Storage Note: The live prototype uses localStorage, but the ERD below follows the logical database design.",
    "",
    "============================================================",
    "RELATIONSHIP OVERVIEW",
    "============================================================",
    "COMMUNITY (1) ----- (M) USER",
    "COMMUNITY (1) ----- (M) EMERGENCY_CONTACT",
    "COMMUNITY (1) ----- (M) DISASTER",
    "COMMUNITY (1) ----- (M) EVACUATION_CENTER",
    "ORGANIZATION (1) -- (M) EMERGENCY_CONTACT",
    "EMERGENCY_CONTACT (1) -- (M) CONTACT_NUMBER",
    "DISASTER (1) ------ (M) DISASTER_ANNOUNCEMENT",
    "EVACUATION_CENTER (1) -- (M) CENTER_CONTACT",
    "",
    "============================================================",
    "ENTITY DEFINITIONS",
    "============================================================",
    "",
    "1. COMMUNITY",
    "PK: CommunityID",
    "Attributes:",
    "- CommunityID",
    "- CommunityName",
    "- Barangay",
    "- City",
    "- Province",
    "- Population",
    "Rules:",
    "- Each COMMUNITY is uniquely identified by CommunityID.",
    "- Each COMMUNITY must have at least one USER.",
    "- A COMMUNITY may have zero or many EMERGENCY_CONTACTS, DISASTERS, and EVACUATION_CENTERS.",
    "",
    "2. USER",
    "PK: UserID",
    "FK: CommunityID -> COMMUNITY.CommunityID",
    "Attributes:",
    "- UserID",
    "- FullName",
    "- Username",
    "- Password",
    "- Role",
    "- Email",
    "- CommunityID",
    "Rules:",
    "- Each USER belongs to exactly one COMMUNITY.",
    "- Role must be Admin or Officer.",
    "- Username must be unique.",
    "- Email must be unique.",
    "",
    "3. ORGANIZATION",
    "PK: OrganizationID",
    "Attributes:",
    "- OrganizationID",
    "- OrganizationName",
    "- Type",
    "",
    "4. EMERGENCY_CONTACT",
    "PK: ContactID",
    "FK: OrganizationID -> ORGANIZATION.OrganizationID",
    "FK: CommunityID -> COMMUNITY.CommunityID",
    "Attributes:",
    "- ContactID",
    "- Name",
    "- Role",
    "- Email",
    "- OrganizationID",
    "- CommunityID",
    "Rules:",
    "- Each EMERGENCY_CONTACT belongs to exactly one ORGANIZATION.",
    "- Each EMERGENCY_CONTACT belongs to exactly one COMMUNITY.",
    "- Each EMERGENCY_CONTACT must have at least one CONTACT_NUMBER.",
    "",
    "5. CONTACT_NUMBER",
    "PK: ContactNumberID",
    "FK: ContactID -> EMERGENCY_CONTACT.ContactID",
    "Attributes:",
    "- ContactNumberID",
    "- PhoneNumber",
    "- Network",
    "- ContactID",
    "Rules:",
    "- Each CONTACT_NUMBER belongs to exactly one EMERGENCY_CONTACT.",
    "",
    "6. DISASTER",
    "PK: DisasterID",
    "FK: CommunityID -> COMMUNITY.CommunityID",
    "Attributes:",
    "- DisasterID",
    "- DisasterType",
    "- Description",
    "- SeverityLevel",
    "- DateOccurred",
    "- CommunityID",
    "Rules:",
    "- Each DISASTER occurs in exactly one COMMUNITY.",
    "",
    "7. DISASTER_ANNOUNCEMENT",
    "PK: AnnouncementID",
    "FK: DisasterID -> DISASTER.DisasterID",
    "Attributes:",
    "- AnnouncementID",
    "- Title",
    "- Message",
    "- AlertLevel",
    "- DateIssued",
    "- DisasterID",
    "Rules:",
    "- Each DISASTER_ANNOUNCEMENT belongs to exactly one DISASTER.",
    "",
    "8. EVACUATION_CENTER",
    "PK: CenterID",
    "FK: CommunityID -> COMMUNITY.CommunityID",
    "Attributes:",
    "- CenterID",
    "- CenterName",
    "- Location",
    "- Capacity",
    "- CommunityID",
    "Rules:",
    "- Each EVACUATION_CENTER belongs to exactly one COMMUNITY.",
    "",
    "9. CENTER_CONTACT",
    "PK: CenterContactID",
    "FK: CenterID -> EVACUATION_CENTER.CenterID",
    "Attributes:",
    "- CenterContactID",
    "- ContactName",
    "- PhoneNumber",
    "- CenterID",
    "Rules:",
    "- Each CENTER_CONTACT belongs to exactly one EVACUATION_CENTER.",
    "",
    "============================================================",
    "APP FIELD MAP",
    "============================================================",
    "COMMUNITY.CommunityID -> communities.id",
    "USER.UserID -> users.id",
    "USER.CommunityID -> users.community_id",
    "ORGANIZATION.OrganizationID -> organizations.id",
    "EMERGENCY_CONTACT.ContactID -> emergency_contacts.id",
    "EMERGENCY_CONTACT.OrganizationID -> emergency_contacts.organization_id",
    "EMERGENCY_CONTACT.CommunityID -> emergency_contacts.community_id",
    "CONTACT_NUMBER.ContactNumberID -> contact_numbers.id",
    "CONTACT_NUMBER.ContactID -> contact_numbers.contact_id",
    "DISASTER.DisasterID -> disasters.id",
    "DISASTER.CommunityID -> disasters.community_id",
    "DISASTER_ANNOUNCEMENT.AnnouncementID -> announcements.id",
    "DISASTER_ANNOUNCEMENT.DisasterID -> announcements.disaster_id",
    "EVACUATION_CENTER.CenterID -> evacuation_centers.id",
    "EVACUATION_CENTER.CommunityID -> evacuation_centers.community_id",
    "CENTER_CONTACT.CenterContactID -> center_contacts.id",
    "CENTER_CONTACT.CenterID -> center_contacts.center_id",
    "",
    "Note: The internal _meta object in localStorage is for app migration only and is not part of the ERD.",
  ];

  return lines.join("\n");
}

function requireCurrentUser(database) {
  const sessionUserId = getSessionUserId();
  if (!sessionUserId) {
    throw makeError("Please log in to continue.", 401);
  }
  const user = database.users.find((item) => item.id === sessionUserId);
  if (!user) {
    clearSessionUser();
    throw makeError("Please log in to continue.", 401);
  }
  return user;
}

function hasManageSession(database) {
  const sessionUserId = getSessionUserId();
  if (!sessionUserId) {
    return false;
  }
  const user = database.users.find((item) => item.id === sessionUserId);
  return Boolean(user && ["Admin", "Officer"].includes(user.role));
}

function ensureWriteAccess(user, resource) {
  if (!["Admin", "Officer"].includes(user.role)) {
    throw makeError("Only Admin and Officer accounts can manage records.", 403);
  }
}

function validateUniqueUser(database, username, email, excludeId = null) {
  const normalizedUsername = normalizeText(username, "username");
  const normalizedEmail = normalizeEmail(email);

  const usernameExists = database.users.some(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase() && user.id !== excludeId
  );
  if (usernameExists) {
    throw makeError("Username is already in use.");
  }

  const emailExists = database.users.some(
    (user) => user.email.toLowerCase() === normalizedEmail && user.id !== excludeId
  );
  if (emailExists) {
    throw makeError("Email is already in use.");
  }

  return { normalizedUsername, normalizedEmail };
}

function normalizePhoneNumbers(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw makeError("At least one contact number is required.");
  }
  return items.map((item, index) => ({
    phone_number: normalizePhoneNumber(
      item?.phone_number,
      `phone_numbers[${index + 1}].phone_number`
    ),
    network: normalizeText(item?.network, `phone_numbers[${index + 1}].network`),
  }));
}

function normalizeCenterContacts(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw makeError("At least one center contact is required.");
  }
  return items.map((item, index) => ({
    contact_name: normalizeText(item?.contact_name, `center_contacts[${index + 1}].contact_name`),
    phone_number: normalizePhoneNumber(
      item?.phone_number,
      `center_contacts[${index + 1}].phone_number`,
      { allowLandline: true }
    ),
  }));
}

function handleLocalApi(database, method, path, payload) {
  if (path === "/api/login" && method === "POST") {
    const username = normalizeText(payload.username, "username");
    const password = normalizeText(payload.password, "password");
    const user = database.users.find(
      (item) => item.username === username && item.password_hash === hashPassword(password)
    );
    if (!user) {
      throw makeError("Invalid username or password.", 401);
    }
    setSessionUserId(user.id);
    return { message: "Logged in successfully.", user: projectUser(database, user) };
  }

  if (path === "/api/logout" && method === "POST") {
    clearSessionUser();
    return { message: "Logged out successfully." };
  }

  if (path === "/api/export" && method === "GET") {
    return buildExportData(database);
  }

  if (path === "/api/session" && method === "GET") {
    const sessionUserId = getSessionUserId();
    const sessionUser = sessionUserId ? database.users.find((item) => item.id === sessionUserId) : null;
    return { user: sessionUser ? projectUser(database, sessionUser) : null };
  }
  if (path === "/api/dashboard" && method === "GET") {
    return buildDashboard(database);
  }
  if (path === "/api/lookups" && method === "GET") {
    return buildLookups(database);
  }

  const resourcePath = path.replace(/^\/api\//, "").replace(/\/+$/, "");
  const parts = resourcePath.split("/").filter(Boolean);
  if (!parts.length) {
    throw makeError("Resource not found.", 404);
  }

  const resource = parts[0];
  const itemId = parts[1] ? Number(parts[1]) : null;
  if (parts.length > 2 || (parts[1] && !Number.isInteger(itemId))) {
    throw makeError("Record not found.", 404);
  }

  const listHandlers = {
    communities: () => buildCommunities(database),
    users: () => buildUsers(database),
    organizations: () => buildOrganizations(database),
    "emergency-contacts": () => buildContacts(database),
    disasters: () => buildDisasters(database),
    announcements: () => buildAnnouncements(database),
    "evacuation-centers": () => buildCenters(database),
  };

  if (!listHandlers[resource]) {
    throw makeError("Resource not found.", 404);
  }

  if (method === "GET" && !itemId) {
    if (resource === "users" && !hasManageSession(database)) {
      throw makeError("Please log in as an Admin or Officer to view user accounts.", 401);
    }
    return listHandlers[resource]();
  }

  const currentUser = requireCurrentUser(database);

  if (method === "POST" && !itemId) {
    ensureWriteAccess(currentUser, resource);
    createRecord(database, resource, payload);
    stampDatabaseUpdate(database, currentUser);
    saveDatabase(database);
    return { message: "Record created successfully." };
  }

  if (method === "PUT" && itemId) {
    ensureWriteAccess(currentUser, resource);
    updateRecord(database, resource, itemId, payload);
    stampDatabaseUpdate(database, currentUser);
    saveDatabase(database);
    return { message: "Record updated successfully." };
  }

  if (method === "DELETE" && itemId) {
    ensureWriteAccess(currentUser, resource);
    deleteRecord(database, resource, itemId, currentUser.id);
    stampDatabaseUpdate(database, currentUser);
    saveDatabase(database);
    return { message: "Record deleted successfully." };
  }

  throw makeError("Method not allowed for this resource.", 405);
}

function createRecord(database, resource, payload) {
  if (resource === "communities") {
    const initialUser = payload.initial_user;
    if (!initialUser || typeof initialUser !== "object") {
      throw makeError("initial_user is required when creating a community.");
    }

    const community = {
      id: nextId(database.communities),
      community_name: normalizeText(payload.community_name, "community_name"),
      barangay: normalizeText(payload.barangay, "barangay"),
      city: normalizeText(payload.city, "city"),
      province: normalizeText(payload.province, "province"),
      population: normalizeInt(payload.population, "population"),
    };

    const duplicateCommunity = database.communities.some(
      (item) =>
        item.community_name.toLowerCase() === community.community_name.toLowerCase() &&
        item.barangay.toLowerCase() === community.barangay.toLowerCase() &&
        item.city.toLowerCase() === community.city.toLowerCase() &&
        item.province.toLowerCase() === community.province.toLowerCase()
    );
    if (duplicateCommunity) {
      throw makeError("That community already exists.");
    }

    const { normalizedUsername, normalizedEmail } = validateUniqueUser(
      database,
      initialUser.username,
      initialUser.email
    );

    database.communities.push(community);
    database.users.push({
      id: nextId(database.users),
      community_id: community.id,
      full_name: normalizeText(initialUser.full_name, "initial_user.full_name"),
      username: normalizedUsername,
      password_hash: hashPassword(normalizeText(initialUser.password, "initial_user.password")),
      role: normalizeRole(initialUser.role),
      email: normalizedEmail,
    });
    return;
  }

  if (resource === "users") {
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    const { normalizedUsername, normalizedEmail } = validateUniqueUser(database, payload.username, payload.email);
    database.users.push({
      id: nextId(database.users),
      community_id: communityId,
      full_name: normalizeText(payload.full_name, "full_name"),
      username: normalizedUsername,
      password_hash: hashPassword(normalizeText(payload.password, "password")),
      role: normalizeRole(payload.role),
      email: normalizedEmail,
    });
    return;
  }

  if (resource === "organizations") {
    database.organizations.push({
      id: nextId(database.organizations),
      organization_name: normalizeText(payload.organization_name, "organization_name"),
      type: normalizeText(payload.type, "type"),
    });
    return;
  }

  if (resource === "emergency-contacts") {
    const organizationId = normalizeId(payload.organization_id, "organization_id");
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "organizations", organizationId, "Organization");
    getRecord(database, "communities", communityId, "Community");
    const contactId = nextId(database.emergency_contacts);
    database.emergency_contacts.push({
      id: contactId,
      organization_id: organizationId,
      community_id: communityId,
      name: normalizeText(payload.name, "name"),
      role: normalizeText(payload.role, "role"),
      email: normalizeEmail(payload.email),
    });
    normalizePhoneNumbers(payload.phone_numbers).forEach((item) => {
      database.contact_numbers.push({
        id: nextId(database.contact_numbers),
        contact_id: contactId,
        ...item,
      });
    });
    return;
  }

  if (resource === "disasters") {
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    database.disasters.push({
      id: nextId(database.disasters),
      community_id: communityId,
      disaster_type: normalizeText(payload.disaster_type, "disaster_type"),
      description: normalizeText(payload.description, "description"),
      severity_level: normalizeSeverity(payload.severity_level),
      date_occurred: normalizeDate(payload.date_occurred, "date_occurred"),
    });
    return;
  }

  if (resource === "announcements") {
    const disasterId = normalizeId(payload.disaster_id, "disaster_id");
    getRecord(database, "disasters", disasterId, "Disaster");
    database.announcements.push({
      id: nextId(database.announcements),
      disaster_id: disasterId,
      title: normalizeText(payload.title, "title"),
      message: normalizeText(payload.message, "message"),
      alert_level: normalizeAlertLevel(payload.alert_level),
      date_issued: normalizeDate(payload.date_issued, "date_issued"),
    });
    return;
  }

  if (resource === "evacuation-centers") {
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    const centerId = nextId(database.evacuation_centers);
    database.evacuation_centers.push({
      id: centerId,
      community_id: communityId,
      center_name: normalizeText(payload.center_name, "center_name"),
      location: normalizeText(payload.location, "location"),
      capacity: normalizeInt(payload.capacity, "capacity"),
    });
    normalizeCenterContacts(payload.center_contacts).forEach((item) => {
      database.center_contacts.push({
        id: nextId(database.center_contacts),
        center_id: centerId,
        ...item,
      });
    });
    return;
  }

  throw makeError("Resource not found.", 404);
}

function updateRecord(database, resource, itemId, payload) {
  if (resource === "communities") {
    const community = getRecord(database, "communities", itemId, "Community");
    const updated = {
      community_name: normalizeText(payload.community_name, "community_name"),
      barangay: normalizeText(payload.barangay, "barangay"),
      city: normalizeText(payload.city, "city"),
      province: normalizeText(payload.province, "province"),
      population: normalizeInt(payload.population, "population"),
    };

    const duplicateCommunity = database.communities.some(
      (item) =>
        item.id !== itemId &&
        item.community_name.toLowerCase() === updated.community_name.toLowerCase() &&
        item.barangay.toLowerCase() === updated.barangay.toLowerCase() &&
        item.city.toLowerCase() === updated.city.toLowerCase() &&
        item.province.toLowerCase() === updated.province.toLowerCase()
    );
    if (duplicateCommunity) {
      throw makeError("That community already exists.");
    }

    Object.assign(community, updated);
    return;
  }

  if (resource === "users") {
    const user = getRecord(database, "users", itemId, "User");
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    const { normalizedUsername, normalizedEmail } = validateUniqueUser(
      database,
      payload.username,
      payload.email,
      itemId
    );
    if (user.community_id !== communityId) {
      const sourceCommunityUsers = database.users.filter((item) => item.community_id === user.community_id);
      if (sourceCommunityUsers.length <= 1) {
        throw makeError("Each community must keep at least one user.");
      }
    }
    user.community_id = communityId;
    user.full_name = normalizeText(payload.full_name, "full_name");
    user.username = normalizedUsername;
    user.role = normalizeRole(payload.role);
    user.email = normalizedEmail;
    if (typeof payload.password === "string" && payload.password.trim()) {
      user.password_hash = hashPassword(payload.password.trim());
    }
    return;
  }

  if (resource === "organizations") {
    const organization = getRecord(database, "organizations", itemId, "Organization");
    organization.organization_name = normalizeText(payload.organization_name, "organization_name");
    organization.type = normalizeText(payload.type, "type");
    return;
  }

  if (resource === "emergency-contacts") {
    const contact = getRecord(database, "emergency_contacts", itemId, "Emergency contact");
    const organizationId = normalizeId(payload.organization_id, "organization_id");
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "organizations", organizationId, "Organization");
    getRecord(database, "communities", communityId, "Community");
    contact.organization_id = organizationId;
    contact.community_id = communityId;
    contact.name = normalizeText(payload.name, "name");
    contact.role = normalizeText(payload.role, "role");
    contact.email = normalizeEmail(payload.email);
    database.contact_numbers = database.contact_numbers.filter((item) => item.contact_id !== itemId);
    normalizePhoneNumbers(payload.phone_numbers).forEach((item) => {
      database.contact_numbers.push({
        id: nextId(database.contact_numbers),
        contact_id: itemId,
        ...item,
      });
    });
    return;
  }

  if (resource === "disasters") {
    const disaster = getRecord(database, "disasters", itemId, "Disaster");
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    disaster.community_id = communityId;
    disaster.disaster_type = normalizeText(payload.disaster_type, "disaster_type");
    disaster.description = normalizeText(payload.description, "description");
    disaster.severity_level = normalizeSeverity(payload.severity_level);
    disaster.date_occurred = normalizeDate(payload.date_occurred, "date_occurred");
    return;
  }

  if (resource === "announcements") {
    const announcement = getRecord(database, "announcements", itemId, "Announcement");
    const disasterId = normalizeId(payload.disaster_id, "disaster_id");
    getRecord(database, "disasters", disasterId, "Disaster");
    announcement.disaster_id = disasterId;
    announcement.title = normalizeText(payload.title, "title");
    announcement.message = normalizeText(payload.message, "message");
    announcement.alert_level = normalizeAlertLevel(payload.alert_level);
    announcement.date_issued = normalizeDate(payload.date_issued, "date_issued");
    return;
  }

  if (resource === "evacuation-centers") {
    const center = getRecord(database, "evacuation_centers", itemId, "Evacuation center");
    const communityId = normalizeId(payload.community_id, "community_id");
    getRecord(database, "communities", communityId, "Community");
    center.community_id = communityId;
    center.center_name = normalizeText(payload.center_name, "center_name");
    center.location = normalizeText(payload.location, "location");
    center.capacity = normalizeInt(payload.capacity, "capacity");
    database.center_contacts = database.center_contacts.filter((item) => item.center_id !== itemId);
    normalizeCenterContacts(payload.center_contacts).forEach((item) => {
      database.center_contacts.push({
        id: nextId(database.center_contacts),
        center_id: itemId,
        ...item,
      });
    });
    return;
  }

  throw makeError("Resource not found.", 404);
}

function deleteRecord(database, resource, itemId, currentUserId) {
  if (resource === "communities") {
    getRecord(database, "communities", itemId, "Community");
    const userIds = database.users.filter((user) => user.community_id === itemId).map((user) => user.id);
    const contactIds = database.emergency_contacts.filter((contact) => contact.community_id === itemId).map((contact) => contact.id);
    const disasterIds = database.disasters.filter((disaster) => disaster.community_id === itemId).map((disaster) => disaster.id);
    const centerIds = database.evacuation_centers.filter((center) => center.community_id === itemId).map((center) => center.id);

    if (userIds.includes(currentUserId)) {
      throw makeError("You cannot delete the community tied to the account currently in use.");
    }

    database.contact_numbers = database.contact_numbers.filter((item) => !contactIds.includes(item.contact_id));
    database.announcements = database.announcements.filter((item) => !disasterIds.includes(item.disaster_id));
    database.center_contacts = database.center_contacts.filter((item) => !centerIds.includes(item.center_id));
    database.users = database.users.filter((item) => item.community_id !== itemId);
    database.emergency_contacts = database.emergency_contacts.filter((item) => item.community_id !== itemId);
    database.disasters = database.disasters.filter((item) => item.community_id !== itemId);
    database.evacuation_centers = database.evacuation_centers.filter((item) => item.community_id !== itemId);
    database.communities = database.communities.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "users") {
    const user = getRecord(database, "users", itemId, "User");
    if (itemId === currentUserId) {
      throw makeError("You cannot delete the account currently in use.");
    }
    const remainingUsers = database.users.filter((item) => item.community_id === user.community_id);
    if (remainingUsers.length <= 1) {
      throw makeError("Each community must keep at least one user.");
    }
    database.users = database.users.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "organizations") {
    getRecord(database, "organizations", itemId, "Organization");
    const hasContacts = database.emergency_contacts.some((contact) => contact.organization_id === itemId);
    if (hasContacts) {
      throw makeError("This organization still has linked emergency contacts.");
    }
    database.organizations = database.organizations.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "emergency-contacts") {
    getRecord(database, "emergency_contacts", itemId, "Emergency contact");
    database.contact_numbers = database.contact_numbers.filter((item) => item.contact_id !== itemId);
    database.emergency_contacts = database.emergency_contacts.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "disasters") {
    getRecord(database, "disasters", itemId, "Disaster");
    database.announcements = database.announcements.filter((item) => item.disaster_id !== itemId);
    database.disasters = database.disasters.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "announcements") {
    getRecord(database, "announcements", itemId, "Announcement");
    database.announcements = database.announcements.filter((item) => item.id !== itemId);
    return;
  }

  if (resource === "evacuation-centers") {
    getRecord(database, "evacuation_centers", itemId, "Evacuation center");
    database.center_contacts = database.center_contacts.filter((item) => item.center_id !== itemId);
    database.evacuation_centers = database.evacuation_centers.filter((item) => item.id !== itemId);
    return;
  }

  throw makeError("Resource not found.", 404);
}

function renderChrome() {
  const canManage = hasManageAccess();
  const usersNavButton = elements.navButtons.find((button) => button.dataset.sectionTarget === "users");

  if (canManage) {
    elements.userName.textContent = state.user.full_name;
    elements.userRole.textContent = state.user.role;
  } else {
    elements.userName.textContent = "Public Bulletin";
    elements.userRole.textContent = "Read-Only Access";
  }

  elements.sectionButtons.community.classList.toggle("hidden", !canManage);
  elements.sectionButtons.user.classList.toggle("hidden", !canManage);
  elements.sectionButtons.organization.classList.toggle("hidden", !canManage);
  elements.sectionButtons.contact.classList.toggle("hidden", !canManage);
  elements.sectionButtons.disaster.classList.toggle("hidden", !canManage);
  elements.sectionButtons.center.classList.toggle("hidden", !canManage);
  elements.adminLoginButton.classList.toggle("hidden", canManage);
  elements.logoutButton.classList.toggle("hidden", !canManage);
  elements.exportButton.classList.toggle("hidden", !canManage);
  elements.exportTxtButton.classList.toggle("hidden", !canManage);
  elements.exportErdButton.classList.toggle("hidden", !canManage);
  if (usersNavButton) {
    usersNavButton.classList.toggle("hidden", !canManage);
  }
  document.getElementById("users-section").classList.toggle("hidden", !canManage);

  if (!canManage && state.activeSection === "users") {
    applySection("dashboard");
  }
}

function renderAllSections() {
  renderDashboard();
  renderCommunities();
  renderUsers();
  renderOrganizations();
  renderContacts();
  renderDisasters();
  renderCenters();
}

function renderSection(key) {
  const renderers = {
    communities: renderCommunities,
    users: renderUsers,
    organizations: renderOrganizations,
    contacts: renderContacts,
    disasters: renderDisasters,
    centers: renderCenters,
  };
  if (renderers[key]) {
    renderers[key]();
  }
}

function showApp() {
  closeLoginOverlay();
  elements.appShell.classList.remove("hidden");
}

function showLogin() {
  openLoginOverlay();
}

function openLoginOverlay() {
  elements.loginView.classList.remove("hidden");
  elements.loginUsername.focus();
}

function closeLoginOverlay() {
  elements.loginView.classList.add("hidden");
}

function applySection(sectionName) {
  state.activeSection = sectionName;
  localStorage.setItem("cdiecs-active-section", sectionName);

  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.sectionTarget === sectionName);
  });

  document.querySelectorAll(".content-section").forEach((section) => {
    section.classList.toggle("active", section.id === `${sectionName}-section`);
  });
}

function hasManageAccess() {
  return Boolean(state.user && ["Admin", "Officer"].includes(state.user.role));
}

function formatDate(value) {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(`${value}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emptyState(message) {
  const title = /search/i.test(message) ? "No matching records" : "Nothing to show";
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function textMatches(search, ...values) {
  if (!search) {
    return true;
  }
  return values.some((value) => String(value ?? "").toLowerCase().includes(search));
}

function getCommunityById(id) {
  return state.communities.find((item) => item.id === id);
}

function getUserById(id) {
  return state.users.find((item) => item.id === id);
}

function getOrganizationById(id) {
  return state.organizations.find((item) => item.id === id);
}

function getContactById(id) {
  return state.contacts.find((item) => item.id === id);
}

function getDisasterById(id) {
  return state.disasters.find((item) => item.id === id);
}

function getAnnouncementById(id) {
  for (const disaster of state.disasters) {
    const found = disaster.announcements.find((announcement) => announcement.id === id);
    if (found) {
      return found;
    }
  }
  return null;
}

function getCenterById(id) {
  return state.centers.find((item) => item.id === id);
}

function showToast(message, variant = "success") {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${variant}`;
  elements.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}

function badgeMarkup(label, variantClass = "") {
  return `<span class="badge ${variantClass}">${escapeHtml(label)}</span>`;
}

function erdIdBadge(label, value) {
  return `<span class="badge erd-id"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`;
}

function statusStamp(label, variantClass = "") {
  return `<span class="status-stamp ${variantClass}">${escapeHtml(label)}</span>`;
}

function actionButton(label, action, id, extra = "") {
  return `<button type="button" class="small-btn" data-action="${action}" data-id="${id}" ${extra}>${escapeHtml(label)}</button>`;
}

function renderDashboard() {
  if (!state.dashboard) {
    elements.content.dashboard.innerHTML = emptyState("Dashboard data is not available yet.");
    return;
  }

  const counts = state.dashboard.counts;
  const quickReference = state.dashboard.quick_reference || {};
  const accessLabel = hasManageAccess()
    ? `${state.user.role} management access`
    : "Public access";
  const announcements = state.dashboard.recent_announcements
    .map(
      (item) => `
        <article class="record-card alert-card">
          <div class="record-card-header">
            <div>
              <h3>${escapeHtml(item.title)}</h3>
              <p class="meta-line">${escapeHtml(item.disaster_type)} | ${escapeHtml(item.community_label)}</p>
            </div>
            <div class="badge-stack">
              ${badgeMarkup(item.timeliness_label, item.timeliness_class)}
              ${badgeMarkup(item.alert_level, `alert-${item.alert_level.toLowerCase()}`)}
            </div>
          </div>
          <p>${escapeHtml(summarizeText(item.message, 170))}</p>
          <div class="record-footer">
            <p class="meta-line">Issued ${escapeHtml(formatDate(item.date_issued))}</p>
          </div>
        </article>
      `
    )
    .join("");

  const contacts = state.dashboard.contacts
    .map(
      (item) => `
        <article class="record-card directory-card">
          <div class="record-card-header">
            <div>
              <h3>${escapeHtml(item.name)}</h3>
              <p class="meta-line">${escapeHtml(item.role)} | ${escapeHtml(item.organization_name)}</p>
            </div>
            <div class="badge">${escapeHtml(item.community_name)}</div>
          </div>
          <div class="directory-phone-strip chip-row">
            ${item.phone_numbers
              .map(
                (phone) => `<div class="chip"><strong>${escapeHtml(phone.network)}</strong>${escapeHtml(phone.phone_number)}</div>`
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");

  const communities = state.dashboard.communities
    .map(
      (item) => `
        <article class="record-card community-card">
          <div class="record-card-header">
            <div>
              <h3>${escapeHtml(item.community_name)}</h3>
              <p class="meta-line">${escapeHtml(item.barangay)}, ${escapeHtml(item.city)}, ${escapeHtml(item.province)}</p>
            </div>
            <div class="badge-stack">
              ${erdIdBadge("CommunityID", item.id)}
              <div class="badge">Population ${formatNumber(item.population)}</div>
            </div>
          </div>
          <div class="chip-row">
            <div class="chip"><strong>Users</strong>${formatNumber(item.user_count)}</div>
            <div class="chip"><strong>Contacts</strong>${formatNumber(item.contact_count)}</div>
            <div class="chip"><strong>Disasters</strong>${formatNumber(item.disaster_count)}</div>
            <div class="chip"><strong>Centers</strong>${formatNumber(item.center_count)}</div>
          </div>
        </article>
      `
    )
    .join("");
  const locationChips = [
    ...quickReference.location_summary?.barangays?.map((item) => ({ label: "Barangay", value: item })) || [],
    ...quickReference.location_summary?.cities?.map((item) => ({ label: "City", value: item })) || [],
    ...quickReference.location_summary?.provinces?.map((item) => ({ label: "Province", value: item })) || [],
  ]
    .slice(0, 6)
    .map((item) => `<div class="chip"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.value)}</div>`)
    .join("");

  elements.content.dashboard.innerHTML = `
    <section class="dashboard-band dashboard-signal">
      <div class="dashboard-signal-head">
        <div class="dashboard-title-block">
          <p class="eyebrow">Operations Snapshot</p>
          <h2>Stay on top of local alerts, verified contacts, and evacuation support</h2>
        </div>
      </div>
      <div class="dashboard-meta-strip dashboard-summary-strip">
        <div class="chip"><strong>Access</strong>${escapeHtml(accessLabel)}</div>
        <div class="chip"><strong>Coverage</strong>${formatNumber(counts.communities)} community records</div>
        <div class="chip"><strong>Updated</strong>${escapeHtml(state.dashboard.generated_at)}</div>
      </div>
      <div class="dashboard-meta-strip dashboard-location-strip">
        ${locationChips || `<div class="chip"><strong>Coverage</strong>No location markers yet</div>`}
      </div>
      <div class="stat-grid stat-grid-compact">
        <article class="stat-card"><p class="eyebrow">Communities</p><div class="stat-value">${formatNumber(counts.communities)}</div></article>
        <article class="stat-card"><p class="eyebrow">Users</p><div class="stat-value">${formatNumber(counts.users)}</div></article>
        <article class="stat-card"><p class="eyebrow">Organizations</p><div class="stat-value">${formatNumber(counts.organizations)}</div></article>
        <article class="stat-card"><p class="eyebrow">Contacts</p><div class="stat-value">${formatNumber(counts.contacts)}</div></article>
        <article class="stat-card"><p class="eyebrow">Disasters</p><div class="stat-value">${formatNumber(counts.disasters)}</div></article>
        <article class="stat-card"><p class="eyebrow">Announcements</p><div class="stat-value">${formatNumber(counts.announcements)}</div></article>
        <article class="stat-card"><p class="eyebrow">Centers</p><div class="stat-value">${formatNumber(counts.centers)}</div></article>
      </div>
    </section>

    <section class="list-card quick-panel">
      <div class="row-split">
        <div>
          <p class="eyebrow">Quick Reference</p>
        </div>
      </div>
      <div class="quick-grid">
        <article class="quick-card">
          <p class="eyebrow">Top Alert</p>
          ${
            quickReference.highlighted_alert
              ? `
                <h4>${escapeHtml(quickReference.highlighted_alert.title)}</h4>
                <div class="badge-stack">
                  ${badgeMarkup(quickReference.highlighted_alert.timeliness_label, quickReference.highlighted_alert.timeliness_class)}
                  ${badgeMarkup(
                    quickReference.highlighted_alert.alert_level,
                    `alert-${quickReference.highlighted_alert.alert_level.toLowerCase()}`
                  )}
                </div>
                <p class="meta-line">${escapeHtml(quickReference.highlighted_alert.community_label)}</p>
              `
              : `<p class="subtle-text">No active or recorded alert yet.</p>`
          }
        </article>
        <article class="quick-card">
          <p class="eyebrow">Priority Hotline</p>
          ${
            quickReference.hotline_contact
              ? `
                <h4>${escapeHtml(quickReference.hotline_contact.name)}</h4>
                <p class="meta-line">${escapeHtml(quickReference.hotline_contact.role)}</p>
                <div class="chip"><strong>${escapeHtml(quickReference.hotline_contact.network || "Line")}</strong>${escapeHtml(
                  quickReference.hotline_contact.phone
                )}</div>
              `
              : `<p class="subtle-text">No hotline contact available.</p>`
          }
        </article>
        <article class="quick-card">
          <p class="eyebrow">Largest Center</p>
          ${
            quickReference.featured_center
              ? `
                <h4>${escapeHtml(quickReference.featured_center.center_name)}</h4>
                <p class="meta-line">${escapeHtml(quickReference.featured_center.location)}</p>
                <div class="chip"><strong>Capacity</strong>${formatNumber(quickReference.featured_center.capacity)}</div>
              `
              : `<p class="subtle-text">No evacuation center recorded.</p>`
          }
        </article>
        <article class="quick-card">
          <p class="eyebrow">Last Change</p>
          <h4>${escapeHtml(quickReference.last_update?.label || "No update history")}</h4>
          <p class="meta-line">${escapeHtml(quickReference.last_update?.detail || "Not available")}</p>
        </article>
      </div>
    </section>

    <div class="dashboard-columns dashboard-main">
      <section class="list-card alerts-panel">
        <div class="row-split">
          <div>
            <p class="eyebrow">Latest Alerts</p>
            <h3>Recent announcements</h3>
          </div>
        </div>
        <div class="alert-feed">
          ${announcements || emptyState("No announcements yet.")}
        </div>
      </section>

      <section class="list-card directory-panel">
        <div class="row-split">
          <div>
            <p class="eyebrow">Response Directory</p>
            <h3>Emergency contacts</h3>
          </div>
        </div>
        <div class="directory-feed">
          ${contacts || emptyState("No contacts yet.")}
        </div>
      </section>
    </div>

    <section class="list-card community-panel">
      <div class="row-split">
        <div>
          <p class="eyebrow">Community Snapshot</p>
          <h3>Community coverage</h3>
        </div>
      </div>
      <div class="card-grid uniform-grid">
        ${communities || emptyState("No communities yet.")}
      </div>
    </section>
  `;
}

function renderCommunities() {
  const search = state.filters.communities;
  const items = state.communities.filter((item) =>
    textMatches(search, item.community_name, item.barangay, item.city, item.province)
  );

  if (!items.length) {
    elements.content.communities.innerHTML = emptyState("No communities match your search.");
    return;
  }

  elements.content.communities.innerHTML = items
    .map(
      (item) => `
        <article class="record-card">
          <div class="record-card-header">
            <div>
              <h3>${escapeHtml(item.community_name)}</h3>
              <p class="meta-line">${escapeHtml(item.barangay)}, ${escapeHtml(item.city)}, ${escapeHtml(item.province)}</p>
            </div>
            <div class="badge-stack">
              ${erdIdBadge("CommunityID", item.id)}
              <div class="badge">Population ${formatNumber(item.population)}</div>
            </div>
          </div>
          <div class="chip-row">
            <div class="chip"><strong>Users</strong>${formatNumber(item.user_count)}</div>
            <div class="chip"><strong>Contacts</strong>${formatNumber(item.contact_count)}</div>
            <div class="chip"><strong>Disasters</strong>${formatNumber(item.disaster_count)}</div>
            <div class="chip"><strong>Centers</strong>${formatNumber(item.center_count)}</div>
          </div>
          ${
            hasManageAccess()
              ? `<div class="inline-actions">
                  ${actionButton("Edit", "edit-community", item.id)}
                  ${actionButton("Delete", "delete-community", item.id)}
                </div>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderUsers() {
  const search = state.filters.users;
  const items = state.users.filter((item) =>
    textMatches(search, item.full_name, item.username, item.email, item.role, item.community_label)
  );

  if (!items.length) {
    elements.content.users.innerHTML = emptyState("No users match your search.");
    return;
  }

  const canManage = hasManageAccess();
  elements.content.users.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>UserID</th>
          <th>Name</th>
          <th>Role</th>
          <th>Username</th>
          <th>Email</th>
          <th>CommunityID</th>
          <th>Community</th>
          ${canManage ? "<th>Actions</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.id)}</td>
                <td>${escapeHtml(item.full_name)}</td>
                <td>${badgeMarkup(item.role)}</td>
                <td>${escapeHtml(item.username)}</td>
                <td>${escapeHtml(item.email)}</td>
                <td>${escapeHtml(item.community_id)}</td>
                <td>${escapeHtml(item.community_label)}</td>
                ${
                  canManage
                    ? `<td class="table-actions">
                        ${actionButton("Edit", "edit-user", item.id)}
                        ${actionButton("Delete", "delete-user", item.id)}
                      </td>`
                    : ""
                }
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOrganizations() {
  const search = state.filters.organizations;
  const items = state.organizations.filter((item) =>
    textMatches(search, item.organization_name, item.type)
  );

  if (!items.length) {
    elements.content.organizations.innerHTML = emptyState("No organizations match your search.");
    return;
  }

  elements.content.organizations.innerHTML = items
    .map(
      (item) => `
        <article class="record-card">
          <div class="record-card-header">
            <div>
              <h3>${escapeHtml(item.organization_name)}</h3>
              <p class="meta-line">${escapeHtml(item.type)}</p>
            </div>
            <div class="badge-stack">
              ${erdIdBadge("OrganizationID", item.id)}
              <div class="badge">${formatNumber(item.contact_count)} linked contact${item.contact_count === 1 ? "" : "s"}</div>
            </div>
          </div>
          ${
            hasManageAccess()
              ? `<div class="inline-actions">
                  ${actionButton("Edit", "edit-organization", item.id)}
                  ${actionButton("Delete", "delete-organization", item.id)}
                </div>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderContacts() {
  const search = state.filters.contacts;
  const canManage = hasManageAccess();
  const listClass = canManage ? "with-actions" : "read-only";
  const focusable = canManage ? ' tabindex="0"' : "";
  const items = state.contacts.filter((item) =>
    textMatches(
      search,
      item.name,
      item.role,
      item.email,
      item.organization_name,
      item.community_label,
      ...item.phone_numbers.map((number) => `${number.network} ${number.phone_number}`)
    )
  );

  if (!items.length) {
    elements.content.contacts.innerHTML = emptyState("No emergency contacts match your search.");
    return;
  }

  elements.content.contacts.innerHTML = `
    <div class="ledger-list ledger-contacts ${listClass}">
      <div class="ledger-header">
        <div class="ledger-cell">Contact</div>
        <div class="ledger-cell">Agency</div>
        <div class="ledger-cell">Community</div>
        <div class="ledger-cell">Directory</div>
        ${canManage ? '<div class="ledger-cell">Actions</div>' : ""}
      </div>
      ${items
        .map(
          (item) => `
            <article class="ledger-row ledger-contact-row"${focusable}>
              <div class="ledger-cell ledger-primary">
                <div class="badge-stack">${erdIdBadge("ContactID", item.id)}</div>
                <strong class="ledger-title">${escapeHtml(item.name)}</strong>
                <span class="ledger-subline">${escapeHtml(item.role)}</span>
              </div>
              <div class="ledger-cell ledger-primary">
                <div class="badge-stack">${erdIdBadge("OrganizationID", item.organization_id)}</div>
                <strong class="ledger-title">${escapeHtml(item.organization_name)}</strong>
                <span class="ledger-subline">Emergency Contact</span>
              </div>
              <div class="ledger-cell">
                <div class="badge-stack">${erdIdBadge("CommunityID", item.community_id)}</div>
                <span class="ledger-subline">${escapeHtml(item.community_label || item.community_name)}</span>
              </div>
              <div class="ledger-cell ledger-directory">
                <span class="meta-line">${escapeHtml(item.email)}</span>
                <div class="ledger-stamp-list">
                  ${item.phone_numbers
                    .map(
                      (number) => `
                        <span class="ledger-tag ledger-tag-stack">
                          <strong>ContactNumberID ${escapeHtml(number.id)}</strong>
                          <span>ContactID ${escapeHtml(number.contact_id)}</span>
                          <span>${escapeHtml(number.network)} ${escapeHtml(number.phone_number)}</span>
                        </span>
                      `
                    )
                    .join("")}
                </div>
              </div>
              ${
                canManage
                  ? `<div class="row-actions">
                      ${actionButton("Edit", "edit-contact", item.id)}
                      ${actionButton("Delete", "delete-contact", item.id)}
                    </div>`
                  : ""
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDisasters() {
  const search = state.filters.disasters;
  const canManage = hasManageAccess();
  const listClass = canManage ? "with-actions" : "read-only";
  const focusable = canManage ? ' tabindex="0"' : "";
  const items = state.disasters.filter((item) =>
    textMatches(
      search,
      item.disaster_type,
      item.description,
      item.severity_level,
      item.community_label,
      ...item.announcements.flatMap((announcement) => [announcement.title, announcement.message, announcement.alert_level])
    )
  );

  if (!items.length) {
    elements.content.disasters.innerHTML = emptyState("No disaster records match your search.");
    return;
  }

  elements.content.disasters.innerHTML = `
    <div class="ledger-list ledger-disasters ${listClass}">
      <div class="ledger-header">
        <div class="ledger-cell">Date</div>
        <div class="ledger-cell">Record</div>
        <div class="ledger-cell">Status</div>
        ${canManage ? '<div class="ledger-cell">Actions</div>' : ""}
      </div>
      ${items
        .map(
          (item) => `
            <article class="ledger-group">
              <div class="ledger-row ledger-disaster-row"${focusable}>
                <div class="ledger-cell">
                  <div class="badge-stack">${erdIdBadge("DisasterID", item.id)}</div>
                  <strong class="ledger-title">${escapeHtml(formatDate(item.date_occurred))}</strong>
                </div>
                <div class="ledger-cell ledger-primary">
                  <strong class="ledger-title">${escapeHtml(item.disaster_type)}</strong>
                  <p class="ledger-summary">${escapeHtml(summarizeText(item.description, 180))}</p>
                  <span class="ledger-subline">CommunityID ${escapeHtml(item.community_id)} | ${escapeHtml(item.community_label)}</span>
                </div>
                <div class="ledger-cell ledger-status-stack">
                  ${statusStamp(item.severity_level, `severity-${item.severity_level.toLowerCase()}`)}
                  <span class="ledger-note">${item.announcements.length} announcement${item.announcements.length === 1 ? "" : "s"}</span>
                </div>
                ${
                  canManage
                    ? `<div class="row-actions">
                        ${actionButton("Edit", "edit-disaster", item.id)}
                        ${actionButton("Delete", "delete-disaster", item.id)}
                        ${actionButton("Add Alert", "add-announcement", item.id)}
                      </div>`
                    : ""
                }
              </div>
              <div class="ledger-subrows">
                <div class="ledger-subheader">Announcements</div>
                ${
                  item.announcements.length
                    ? item.announcements
                        .map(
                          (announcement) => `
                            <div class="ledger-row ledger-announcement-row"${focusable}>
                              <div class="ledger-cell">
                                <div class="badge-stack">${erdIdBadge("AnnouncementID", announcement.id)}</div>
                                <strong class="ledger-title">${escapeHtml(formatDate(announcement.date_issued))}</strong>
                              </div>
                              <div class="ledger-cell ledger-primary">
                                <strong class="ledger-title">${escapeHtml(announcement.title)}</strong>
                                <p class="ledger-summary">${escapeHtml(summarizeText(announcement.message, 160))}</p>
                                <span class="ledger-subline">DisasterID ${escapeHtml(announcement.disaster_id)}</span>
                              </div>
                              <div class="ledger-cell ledger-status-stack">
                                ${statusStamp(announcement.alert_level, `alert-${announcement.alert_level.toLowerCase()}`)}
                              </div>
                              ${
                                canManage
                                  ? `<div class="row-actions">
                                      ${actionButton("Edit", "edit-announcement", announcement.id)}
                                      ${actionButton("Delete", "delete-announcement", announcement.id)}
                                    </div>`
                                  : ""
                              }
                            </div>
                          `
                        )
                        .join("")
                    : `<div class="ledger-empty-row">No announcements linked to this disaster yet.</div>`
                }
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCenters() {
  const search = state.filters.centers;
  const canManage = hasManageAccess();
  const listClass = canManage ? "with-actions" : "read-only";
  const focusable = canManage ? ' tabindex="0"' : "";
  const items = state.centers.filter((item) =>
    textMatches(
      search,
      item.center_name,
      item.location,
      item.community_label,
      ...item.center_contacts.flatMap((contact) => [contact.contact_name, contact.phone_number])
    )
  );

  if (!items.length) {
    elements.content.centers.innerHTML = emptyState("No evacuation centers match your search.");
    return;
  }

  elements.content.centers.innerHTML = `
    <div class="ledger-list ledger-centers ${listClass}">
      <div class="ledger-header">
        <div class="ledger-cell">Center</div>
        <div class="ledger-cell">Community</div>
        <div class="ledger-cell">Capacity</div>
        <div class="ledger-cell">Center Contacts</div>
        ${canManage ? '<div class="ledger-cell">Actions</div>' : ""}
      </div>
      ${items
        .map(
          (item) => `
            <article class="ledger-row ledger-center-row"${focusable}>
              <div class="ledger-cell ledger-primary">
                <div class="badge-stack">${erdIdBadge("CenterID", item.id)}</div>
                <strong class="ledger-title">${escapeHtml(item.center_name)}</strong>
                <p class="ledger-summary">${escapeHtml(item.location)}</p>
              </div>
              <div class="ledger-cell">
                <div class="badge-stack">${erdIdBadge("CommunityID", item.community_id)}</div>
                <span class="ledger-subline">${escapeHtml(item.community_label)}</span>
              </div>
              <div class="ledger-cell">
                <strong class="ledger-title">${formatNumber(item.capacity)}</strong>
              </div>
              <div class="ledger-cell ledger-directory">
                <div class="ledger-stamp-list">
                  ${item.center_contacts
                    .map(
                      (contact) => `
                        <span class="ledger-tag ledger-tag-stack">
                          <strong>CenterContactID ${escapeHtml(contact.id)}</strong>
                          <span>CenterID ${escapeHtml(contact.center_id)}</span>
                          <span>${escapeHtml(contact.contact_name)} ${escapeHtml(contact.phone_number)}</span>
                        </span>
                      `
                    )
                    .join("")}
                </div>
              </div>
              ${
                canManage
                  ? `<div class="row-actions">
                      ${actionButton("Edit", "edit-center", item.id)}
                      ${actionButton("Delete", "delete-center", item.id)}
                    </div>`
                  : ""
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

async function handleDelegatedActions(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  const action = trigger.dataset.action;
  const id = Number(trigger.dataset.id);

  if (!action) {
    return;
  }

  const destructiveMap = {
    "delete-community": { path: `/api/communities/${id}`, message: "Community deleted." },
    "delete-user": { path: `/api/users/${id}`, message: "User deleted." },
    "delete-organization": { path: `/api/organizations/${id}`, message: "Organization deleted." },
    "delete-contact": { path: `/api/emergency-contacts/${id}`, message: "Contact deleted." },
    "delete-disaster": { path: `/api/disasters/${id}`, message: "Disaster record deleted." },
    "delete-announcement": { path: `/api/announcements/${id}`, message: "Announcement deleted." },
    "delete-center": { path: `/api/evacuation-centers/${id}`, message: "Evacuation center deleted." },
  };

  if (destructiveMap[action]) {
    const confirmed = window.confirm("Are you sure you want to delete this record?");
    if (!confirmed) {
      return;
    }
    try {
      await api(destructiveMap[action].path, { method: "DELETE" });
      await loadAllData();
      showToast(destructiveMap[action].message, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const handlerMap = {
    "edit-community": () => openCommunityModal(getCommunityById(id)),
    "edit-user": () => openUserModal(getUserById(id)),
    "edit-organization": () => openOrganizationModal(getOrganizationById(id)),
    "edit-contact": () => openContactModal(getContactById(id)),
    "edit-disaster": () => openDisasterModal(getDisasterById(id)),
    "add-announcement": () => openAnnouncementModal(null, id),
    "edit-announcement": () => openAnnouncementModal(getAnnouncementById(id)),
    "edit-center": () => openCenterModal(getCenterById(id)),
  };

  if (handlerMap[action]) {
    handlerMap[action]();
  }
}

function makeOptions(options, selectedValue) {
  return options
    .map((option) => {
      const entry = typeof option === "string" ? { value: option, label: option } : option;
      const optionValue = entry.value ?? entry.id ?? entry.label ?? "";
      const optionLabel = entry.label ?? entry.name ?? entry.value ?? entry.id ?? "";
      const selected = String(optionValue) === String(selectedValue) ? "selected" : "";
      return `<option value="${escapeHtml(optionValue)}" ${selected}>${escapeHtml(optionLabel)}</option>`;
    })
    .join("");
}

function inputField({ name, label, value = "", type = "text", required = true, fullSpan = false, placeholder = "", list = "" }) {
  return `
    <label class="form-field ${fullSpan ? "full-span" : ""}">
      <span>${escapeHtml(label)}</span>
      <input
        name="${escapeHtml(name)}"
        type="${escapeHtml(type)}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        ${list ? `list="${escapeHtml(list)}"` : ""}
        ${required ? "required" : ""}
      >
    </label>
  `;
}

function textareaField({ name, label, value = "", required = true, fullSpan = true, placeholder = "" }) {
  return `
    <label class="form-field ${fullSpan ? "full-span" : ""}">
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""}>${escapeHtml(value)}</textarea>
    </label>
  `;
}

function selectField({ name, label, options, value = "", required = true, fullSpan = false }) {
  return `
    <label class="form-field ${fullSpan ? "full-span" : ""}">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}" ${required ? "required" : ""}>
        <option value="">Select...</option>
        ${makeOptions(options, value)}
      </select>
    </label>
  `;
}

function recordIdStrip(items) {
  if (!items.length) {
    return "";
  }
  return `
    <div class="record-id-strip full-span">
      ${items.map((item) => erdIdBadge(item.label, item.value)).join("")}
    </div>
  `;
}

function repeatableRowMarkup(type, value = {}) {
  if (type === "phone") {
    return `
      <div class="repeatable-row">
        <div class="form-grid">
          ${value.id ? recordIdStrip([
            { label: "ContactNumberID", value: value.id },
            { label: "ContactID", value: value.contact_id },
          ]) : ""}
          ${inputField({
            name: "ignore-phone-number",
            label: "Phone Number",
            value: value.phone_number || "",
            required: true,
            placeholder: "09XXXXXXXXX",
          }).replace('name="ignore-phone-number"', 'data-field="phone_number"')}
          ${inputField({
            name: "ignore-network",
            label: "Network",
            value: value.network || "",
            required: true,
            placeholder: "Globe / Smart / DITO",
          }).replace('name="ignore-network"', 'data-field="network"')}
        </div>
        <button type="button" class="ghost-btn" data-repeat-remove="phone">Remove</button>
      </div>
    `;
  }

  return `
    <div class="repeatable-row">
      <div class="form-grid">
        ${value.id ? recordIdStrip([
          { label: "CenterContactID", value: value.id },
          { label: "CenterID", value: value.center_id },
        ]) : ""}
        ${inputField({
          name: "ignore-contact-name",
          label: "Contact Name",
          value: value.contact_name || "",
          required: true,
          placeholder: "Person in charge",
        }).replace('name="ignore-contact-name"', 'data-field="contact_name"')}
        ${inputField({
          name: "ignore-contact-phone",
          label: "Phone Number",
          value: value.phone_number || "",
          required: true,
          placeholder: "09XXXXXXXXX",
        }).replace('name="ignore-contact-phone"', 'data-field="phone_number"')}
      </div>
      <button type="button" class="ghost-btn" data-repeat-remove="center-contact">Remove</button>
    </div>
  `;
}

function repeatableShell(type, title, buttonLabel, rowsMarkup) {
  return `
    <section class="repeatable-shell full-span">
      <div class="row-split">
        <div>
          <p class="eyebrow">${escapeHtml(title)}</p>
        </div>
        <button type="button" class="ghost-btn" data-repeat-add="${escapeHtml(type)}">${escapeHtml(buttonLabel)}</button>
      </div>
      <div class="repeatable-list" data-repeatable-list="${escapeHtml(type)}">
        ${rowsMarkup}
      </div>
    </section>
  `;
}

function showModal({ title, subtitle = "", formHtml, submitLabel, onSubmit, onOpen }) {
  elements.modalOverlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Record Editor</p>
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="subtle-text">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <button type="button" class="ghost-btn" data-close-modal>Close</button>
      </div>
      <form id="modal-form" class="stack-form">
        <div class="form-grid">
          ${formHtml}
        </div>
        <div class="inline-actions">
          <button type="button" class="ghost-btn" data-close-modal>Cancel</button>
          <button type="submit" class="primary-btn">${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    </div>
  `;
  elements.modalOverlay.classList.remove("hidden");

  const form = elements.modalOverlay.querySelector("#modal-form");
  elements.modalOverlay.onclick = (event) => {
    if (event.target === elements.modalOverlay || event.target.closest("[data-close-modal]")) {
      closeModal();
      return;
    }

    const addButton = event.target.closest("[data-repeat-add]");
    if (addButton) {
      const type = addButton.dataset.repeatAdd;
      const list = elements.modalOverlay.querySelector(`[data-repeatable-list="${type}"]`);
      list.insertAdjacentHTML("beforeend", repeatableRowMarkup(type));
      return;
    }

    const removeButton = event.target.closest("[data-repeat-remove]");
    if (removeButton) {
      const list = removeButton.closest("[data-repeatable-list]");
      const rows = list.querySelectorAll(".repeatable-row");
      if (rows.length <= 1) {
        showToast("At least one row is required here.", "error");
        return;
      }
      removeButton.closest(".repeatable-row").remove();
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const successMessage = await onSubmit(form);
      closeModal();
      await loadAllData();
      showToast(successMessage || "Saved successfully.", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  if (typeof onOpen === "function") {
    onOpen(form);
  }
}

function closeModal() {
  elements.modalOverlay.classList.add("hidden");
  elements.modalOverlay.innerHTML = "";
  elements.modalOverlay.onclick = null;
}

function fieldValue(form, name) {
  return form.elements[name]?.value?.trim() || "";
}

function numericValue(form, name) {
  return Number(form.elements[name]?.value || 0);
}

function collectRepeatableRows(form, type) {
  const rows = Array.from(form.querySelectorAll(`[data-repeatable-list="${type}"] .repeatable-row`));
  return rows.map((row) => {
    const fields = row.querySelectorAll("[data-field]");
    const item = {};
    fields.forEach((field) => {
      item[field.dataset.field] = field.value.trim();
    });
    return item;
  });
}

function communityOptions() {
  return state.lookups?.communities || [];
}

function roleOptions() {
  return (state.lookups?.roles || []).map((role) => ({ value: role, label: role }));
}

function organizationOptions() {
  return state.lookups?.organizations || [];
}

function severityOptions() {
  return (state.lookups?.severity_levels || []).map((item) => ({ value: item, label: item }));
}

function alertOptions() {
  return (state.lookups?.alert_levels || []).map((item) => ({ value: item, label: item }));
}

function disasterOptions() {
  return state.lookups?.disasters || [];
}

function organizationTypeDatalist() {
  return `
    <datalist id="organization-type-list">
      ${(state.lookups?.organization_types || [])
        .map((item) => `<option value="${escapeHtml(item)}"></option>`)
        .join("")}
    </datalist>
  `;
}

function disasterTypeDatalist() {
  return `
    <datalist id="disaster-type-list">
      ${(state.lookups?.disaster_types || [])
        .map((item) => `<option value="${escapeHtml(item)}"></option>`)
        .join("")}
    </datalist>
  `;
}

function openCommunityModal(item = null) {
  const isEdit = Boolean(item);
  const initialUser = `
    <section class="repeatable-shell full-span">
      <div>
        <p class="eyebrow">Initial Community User</p>
        <h3>Create the first account for this community</h3>
      </div>
      <div class="form-grid">
        ${inputField({ name: "initial_full_name", label: "Full Name", placeholder: "Full name" })}
        ${inputField({ name: "initial_username", label: "Username", placeholder: "Unique username" })}
        ${inputField({ name: "initial_email", label: "Email", type: "email", placeholder: "user@community.local" })}
        ${selectField({ name: "initial_role", label: "Role", options: roleOptions(), value: "Officer" })}
        ${inputField({ name: "initial_password", label: "Password", type: "password", placeholder: "Create a password" })}
      </div>
    </section>
  `;

  showModal({
    title: isEdit ? "Edit Community" : "Create Community",
    subtitle: isEdit ? "Update the location and population details." : "Communities require an initial user based on your project rules.",
    submitLabel: isEdit ? "Save Changes" : "Create Community",
    formHtml: `
      ${isEdit ? recordIdStrip([{ label: "CommunityID", value: item.id }]) : ""}
      ${inputField({ name: "community_name", label: "Community Name", value: item?.community_name || "", placeholder: "San Isidro Resilience Hub" })}
      ${inputField({ name: "barangay", label: "Barangay", value: item?.barangay || "", placeholder: "Salvacion" })}
      ${inputField({ name: "city", label: "City", value: item?.city || "", placeholder: "Goa" })}
      ${inputField({ name: "province", label: "Province", value: item?.province || "", placeholder: "Camarines Sur" })}
      ${inputField({ name: "population", label: "Population", value: item?.population || "", type: "number", placeholder: "0" })}
      ${isEdit ? "" : initialUser}
    `,
    onSubmit: async (form) => {
      const payload = {
        community_name: fieldValue(form, "community_name"),
        barangay: fieldValue(form, "barangay"),
        city: fieldValue(form, "city"),
        province: fieldValue(form, "province"),
        population: numericValue(form, "population"),
      };

      if (!isEdit) {
        payload.initial_user = {
          full_name: fieldValue(form, "initial_full_name"),
          username: fieldValue(form, "initial_username"),
          email: fieldValue(form, "initial_email"),
          role: fieldValue(form, "initial_role"),
          password: fieldValue(form, "initial_password"),
        };
      }

      await api(isEdit ? `/api/communities/${item.id}` : "/api/communities", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Community updated." : "Community created.";
    },
  });
}

function openUserModal(item = null) {
  const isEdit = Boolean(item);
  showModal({
    title: isEdit ? "Edit User" : "Create User",
    subtitle: isEdit ? "Leave password blank to keep the current one." : "Assign the user to exactly one community.",
    submitLabel: isEdit ? "Save User" : "Create User",
    formHtml: `
      ${isEdit ? recordIdStrip([
        { label: "UserID", value: item.id },
        { label: "CommunityID", value: item.community_id },
      ]) : ""}
      ${inputField({ name: "full_name", label: "Full Name", value: item?.full_name || "", placeholder: "Full name" })}
      ${inputField({ name: "username", label: "Username", value: item?.username || "", placeholder: "Username" })}
      ${inputField({ name: "email", label: "Email", value: item?.email || "", type: "email", placeholder: "Email address" })}
      ${selectField({ name: "role", label: "Role", options: roleOptions(), value: item?.role || "Officer" })}
      ${selectField({ name: "community_id", label: "Community", options: communityOptions(), value: item?.community_id || "" })}
      ${inputField({
        name: "password",
        label: isEdit ? "New Password" : "Password",
        type: "password",
        required: !isEdit,
        placeholder: isEdit ? "Optional new password" : "Create a password",
      })}
    `,
    onSubmit: async (form) => {
      const payload = {
        full_name: fieldValue(form, "full_name"),
        username: fieldValue(form, "username"),
        email: fieldValue(form, "email"),
        role: fieldValue(form, "role"),
        community_id: Number(fieldValue(form, "community_id")),
        password: fieldValue(form, "password"),
      };
      await api(isEdit ? `/api/users/${item.id}` : "/api/users", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "User updated." : "User created.";
    },
  });
}

function openOrganizationModal(item = null) {
  const isEdit = Boolean(item);
  showModal({
    title: isEdit ? "Edit Organization" : "Create Organization",
    submitLabel: isEdit ? "Save Organization" : "Create Organization",
    formHtml: `
      ${isEdit ? recordIdStrip([{ label: "OrganizationID", value: item.id }]) : ""}
      ${inputField({
        name: "organization_name",
        label: "Organization Name",
        value: item?.organization_name || "",
        placeholder: "Organization name",
      })}
      ${inputField({
        name: "type",
        label: "Type",
        value: item?.type || "",
        placeholder: "Government / Health / Rescue",
        list: "organization-type-list",
      })}
      <div class="full-span">${organizationTypeDatalist()}</div>
    `,
    onSubmit: async (form) => {
      const payload = {
        organization_name: fieldValue(form, "organization_name"),
        type: fieldValue(form, "type"),
      };
      await api(isEdit ? `/api/organizations/${item.id}` : "/api/organizations", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Organization updated." : "Organization created.";
    },
  });
}

function openContactModal(item = null) {
  const isEdit = Boolean(item);
  const rows = (item?.phone_numbers || [{ phone_number: "", network: "" }])
    .map((row) => repeatableRowMarkup("phone", row))
    .join("");

  showModal({
    title: isEdit ? "Edit Emergency Contact" : "Create Emergency Contact",
    submitLabel: isEdit ? "Save Contact" : "Create Contact",
    formHtml: `
      ${isEdit ? recordIdStrip([
        { label: "ContactID", value: item.id },
        { label: "OrganizationID", value: item.organization_id },
        { label: "CommunityID", value: item.community_id },
      ]) : ""}
      ${inputField({ name: "name", label: "Contact Name", value: item?.name || "", placeholder: "Name" })}
      ${inputField({ name: "role", label: "Role / Position", value: item?.role || "", placeholder: "DRRM Officer" })}
      ${inputField({ name: "email", label: "Email", value: item?.email || "", type: "email", placeholder: "contact@local" })}
      ${selectField({ name: "organization_id", label: "Organization", options: organizationOptions(), value: item?.organization_id || "" })}
      ${selectField({ name: "community_id", label: "Community", options: communityOptions(), value: item?.community_id || "" })}
      ${repeatableShell("phone", "Contact Numbers", "Add Number", rows)}
    `,
    onSubmit: async (form) => {
      const payload = {
        name: fieldValue(form, "name"),
        role: fieldValue(form, "role"),
        email: fieldValue(form, "email"),
        organization_id: Number(fieldValue(form, "organization_id")),
        community_id: Number(fieldValue(form, "community_id")),
        phone_numbers: collectRepeatableRows(form, "phone"),
      };
      await api(isEdit ? `/api/emergency-contacts/${item.id}` : "/api/emergency-contacts", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Emergency contact updated." : "Emergency contact created.";
    },
  });
}

function openDisasterModal(item = null) {
  const isEdit = Boolean(item);
  showModal({
    title: isEdit ? "Edit Disaster Record" : "Create Disaster Record",
    submitLabel: isEdit ? "Save Disaster" : "Create Disaster",
    formHtml: `
      ${isEdit ? recordIdStrip([
        { label: "DisasterID", value: item.id },
        { label: "CommunityID", value: item.community_id },
      ]) : ""}
      ${inputField({
        name: "disaster_type",
        label: "Disaster Type",
        value: item?.disaster_type || "",
        placeholder: "Type the exact disaster record or pick from the list",
        list: "disaster-type-list",
      })}
      ${selectField({ name: "severity_level", label: "Severity Level", options: severityOptions(), value: item?.severity_level || "" })}
      ${selectField({ name: "community_id", label: "Community", options: communityOptions(), value: item?.community_id || "" })}
      ${inputField({ name: "date_occurred", label: "Date Occurred", value: item?.date_occurred || "", type: "date" })}
      <div class="full-span">${disasterTypeDatalist()}</div>
      ${textareaField({ name: "description", label: "Description", value: item?.description || "", placeholder: "Describe the incident.", fullSpan: true })}
    `,
    onSubmit: async (form) => {
      const payload = {
        disaster_type: fieldValue(form, "disaster_type"),
        severity_level: fieldValue(form, "severity_level"),
        community_id: Number(fieldValue(form, "community_id")),
        date_occurred: fieldValue(form, "date_occurred"),
        description: fieldValue(form, "description"),
      };
      await api(isEdit ? `/api/disasters/${item.id}` : "/api/disasters", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Disaster record updated." : "Disaster record created.";
    },
  });
}

function openAnnouncementModal(item = null, presetDisasterId = null) {
  const isEdit = Boolean(item);
  const selectedDisasterId = item?.disaster_id || presetDisasterId || "";
  showModal({
    title: isEdit ? "Edit Announcement" : "Create Announcement",
    submitLabel: isEdit ? "Save Announcement" : "Create Announcement",
    formHtml: `
      ${isEdit ? recordIdStrip([
        { label: "AnnouncementID", value: item.id },
        { label: "DisasterID", value: item.disaster_id },
      ]) : ""}
      ${selectField({ name: "disaster_id", label: "Disaster Record", options: disasterOptions(), value: selectedDisasterId })}
      ${selectField({ name: "alert_level", label: "Alert Level", options: alertOptions(), value: item?.alert_level || "" })}
      ${inputField({ name: "date_issued", label: "Date Issued", value: item?.date_issued || "", type: "date" })}
      ${inputField({ name: "title", label: "Title", value: item?.title || "", placeholder: "Announcement title", fullSpan: true })}
      ${textareaField({ name: "message", label: "Message", value: item?.message || "", placeholder: "Announcement details.", fullSpan: true })}
    `,
    onSubmit: async (form) => {
      const payload = {
        disaster_id: Number(fieldValue(form, "disaster_id")),
        alert_level: fieldValue(form, "alert_level"),
        date_issued: fieldValue(form, "date_issued"),
        title: fieldValue(form, "title"),
        message: fieldValue(form, "message"),
      };
      await api(isEdit ? `/api/announcements/${item.id}` : "/api/announcements", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Announcement updated." : "Announcement created.";
    },
  });
}

function openCenterModal(item = null) {
  const isEdit = Boolean(item);
  const rows = (item?.center_contacts || [{ contact_name: "", phone_number: "" }])
    .map((row) => repeatableRowMarkup("center-contact", row))
    .join("");

  showModal({
    title: isEdit ? "Edit Evacuation Center" : "Create Evacuation Center",
    submitLabel: isEdit ? "Save Center" : "Create Center",
    formHtml: `
      ${isEdit ? recordIdStrip([
        { label: "CenterID", value: item.id },
        { label: "CommunityID", value: item.community_id },
      ]) : ""}
      ${inputField({ name: "center_name", label: "Center Name", value: item?.center_name || "", placeholder: "Center name" })}
      ${inputField({ name: "location", label: "Location", value: item?.location || "", placeholder: "Location details" })}
      ${selectField({ name: "community_id", label: "Community", options: communityOptions(), value: item?.community_id || "" })}
      ${inputField({ name: "capacity", label: "Capacity", value: item?.capacity || "", type: "number", placeholder: "0" })}
      ${repeatableShell("center-contact", "Center Contacts", "Add Contact", rows)}
    `,
    onSubmit: async (form) => {
      const payload = {
        center_name: fieldValue(form, "center_name"),
        location: fieldValue(form, "location"),
        community_id: Number(fieldValue(form, "community_id")),
        capacity: numericValue(form, "capacity"),
        center_contacts: collectRepeatableRows(form, "center-contact"),
      };
      await api(isEdit ? `/api/evacuation-centers/${item.id}` : "/api/evacuation-centers", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      return isEdit ? "Evacuation center updated." : "Evacuation center created.";
    },
  });
}
