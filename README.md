# NZXT Kraken Elite Spotify Dashboard

A dependency-free, static 640×640 circular dashboard for NZXT CAM Web Integration. It shows local time/date, Spotify now-playing details and CAM-provided CPU/GPU temperatures.

## Requirements

- Windows with NZXT CAM 4.50.0 or newer and a supported Kraken LCD
- A Spotify account and Spotify Developer application
- HTTPS hosting (GitHub Pages works)

## 1. Host over HTTPS

Spotify requires an exact, secure redirect URI (except for loopback development addresses), and CAM must be able to load the page. Any static HTTPS host is suitable.

### GitHub Pages example

1. Create a GitHub repository and upload `index.html`, `styles.css`, `app.js`, and `README.md` at its root.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Wait for GitHub to publish `https://YOUR-NAME.github.io/REPOSITORY/`.
5. Open that URL. Do not guess the Spotify redirect URI—the setup page displays the exact value.

Changing the host, path, or trailing slash changes the redirect URI and requires updating Spotify's app settings.

## 2. Create the Spotify application

1. Sign in at [Spotify for Developers](https://developer.spotify.com/dashboard), create an app, and open its settings.
2. Copy the **Redirect URI** shown on this dashboard's setup page into the Spotify app's Redirect URIs and save it. It must match exactly.
3. Keep the app's **Client ID** (not a client secret) ready for the CAM setup view.

Authorization uses Authorization Code with PKCE. Tokens and the Client ID are stored only in local storage for this origin. No client secret is needed or supported.

> If the Spotify app is in Development Mode, add each intended Spotify user under the app's user-management settings.

## 3. Configure NZXT CAM and connect Spotify

1. Open **NZXT CAM → Lighting**, select the Kraken, and choose **Web Integration**.
2. Edit the custom integration and enter the normal hosted URL shown above, without manually adding a query string.
3. CAM opens that URL as the configuration view and creates the hidden renderer with `?kraken=1`.
4. In CAM's configuration view, paste the Spotify **Client ID**, select **Save**, then select **Connect Spotify** and approve access.

The two same-origin CAM browsers share local storage, so authenticating inside CAM's configuration view makes its Kraken renderer use the same tokens. Authentication done in Chrome, Edge, or another standalone browser does **not** transfer into CAM; those are separate browser storage profiles.

The renderer registers `window.nzxt.v1.onMonitoringDataUpdate`; CAM then supplies monitoring data approximately once per second. No hardware-monitoring server is used.

## Browser preview and local testing

Append `?preview=1` to show the circular LCD view in a normal browser with simulated temperatures. Preview uses real Spotify authentication data from the same origin.

For a quick local static server, run from this folder:

```powershell
py -m http.server 8080
```

Then open `http://127.0.0.1:8080/` for setup and `http://127.0.0.1:8080/?preview=1` for preview. Register the exact redirect URI displayed by the local setup page. Spotify permits explicit loopback redirect URIs for development; use the displayed `127.0.0.1` address rather than `localhost`.

## Troubleshooting

### Spotify authentication fails

- Confirm the redirect URI in Spotify matches the setup page exactly, including scheme, path, port, and trailing slash.
- Confirm the Client ID is from the same Spotify app whose redirect URI you edited.
- If the app is in Development Mode, add your Spotify account to its allowed users.
- Use HTTPS for a deployed site. For local testing, use the loopback URL shown above.
- Select **Disconnect**, reconnect, and approve access again if stored authorization became invalid.
- CAM's configuration and Kraken browsers must load the same origin and path. Do not authenticate on a different hostname or local server and expect its local storage to transfer.
- A temporary network or Spotify outage displays a reconnecting state and retries automatically. A Spotify 429 response is honored using its `Retry-After` value.

### CPU or GPU shows `--`

- Temperature monitoring is available in NZXT CAM 4.50.0 or newer; update CAM first.
- Values only arrive in CAM's Kraken renderer (`?kraken=1`), not an ordinary browser. Use `?preview=1` to verify the UI outside CAM.
- Confirm CAM itself can see the device temperature. Integrated/unsupported GPUs may not expose one.
- Reload the Web Integration after CAM wakes from sleep or after hardware/driver changes.

## Behavior notes

- Spotify is polled every seven seconds, with slower retries on errors and explicit rate-limit handling.
- Expired access tokens refresh automatically. A 401 triggers one forced refresh and retry.
- Tracks, podcast episodes, paused playback, no active device, missing artwork, and long names have safe display states.
- CPU/GPU values fall back to `--`. For multiple GPUs, active/discrete devices are preferred.
