# Community Disaster Information and Emergency Contact System




## ulol = npx live-server



Local prototype web app for the Partido State University database project.

## Stack

- HTML
- CSS
- JavaScript
- localStorage for browser-only storage

## Why localStorage

This version is built to run directly in Live Server or a compiler live preview with no backend. Data is saved in your browser's local storage on your device.

## Run It

```powershell
npx live-server
```

Then open:

```text
http://127.0.0.1:5500
```

## Demo Accounts

- `admin / admin123`
- `officer / officer123`

## Features

- Public view for community information without login
- Admin login for management access
- Local-only role-based login
- Admin and Officer record management
- Community management
- User management
- Organization management
- Emergency contacts with multiple phone numbers
- Disaster records with announcements
- Seeded Bicol typhoon history for realistic prototype data
- Evacuation centers with assigned contacts
- JSON export for local backup
- No backend server required
- Validation for required relationships and phone numbers

## Main Files

- `index.html`
- `templates/index.html`
- `static/styles.css`
- `static/app.js`
