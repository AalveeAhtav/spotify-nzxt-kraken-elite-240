(() => {
  'use strict';

  const KEYS = { clientId: 'krakenSpotify.clientId', tokens: 'krakenSpotify.tokens', verifier: 'krakenSpotify.pkceVerifier', state: 'krakenSpotify.oauthState' };
  const SPOTIFY = { authorize: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token', nowPlaying: 'https://api.spotify.com/v1/me/player/currently-playing', scope: 'user-read-currently-playing' };
  const params = new URLSearchParams(location.search);
  const isKraken = params.get('kraken') === '1';
  const isPreview = params.get('preview') === '1';
  const isDisplay = isKraken || isPreview;
  const $ = (id) => document.getElementById(id);
  const redirectUri = `${location.origin}${location.pathname}`;
  let pollTimer = 0;
  let retryAfter = 0;
  let pollInFlight = false;

  function safeParse(value, fallback = null) { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } }
  function loadTokens() { return safeParse(localStorage.getItem(KEYS.tokens)); }
  function saveTokens(payload, old = {}) {
    const expiresIn = Number(payload.expires_in) || 3600;
    const tokens = { access_token: payload.access_token, refresh_token: payload.refresh_token || old.refresh_token, expires_at: Date.now() + expiresIn * 1000 - 30000 };
    localStorage.setItem(KEYS.tokens, JSON.stringify(tokens));
    return tokens;
  }
  function clearAuth() { localStorage.removeItem(KEYS.tokens); localStorage.removeItem(KEYS.verifier); localStorage.removeItem(KEYS.state); }
  function randomString(bytes = 48) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return base64Url(a); }
  function base64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  async function challenge(verifier) { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }

  async function connect() {
    const clientId = $('clientId').value.trim();
    if (!clientId) return message('Enter and save a Spotify Client ID first.', true);
    localStorage.setItem(KEYS.clientId, clientId);
    const verifier = randomString(); const state = randomString(24);
    localStorage.setItem(KEYS.verifier, verifier); localStorage.setItem(KEYS.state, state);
    const query = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SPOTIFY.scope, code_challenge_method: 'S256', code_challenge: await challenge(verifier), state });
    location.assign(`${SPOTIFY.authorize}?${query}`);
  }

  async function tokenRequest(body) {
    const response = await fetch(SPOTIFY.token, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || `Spotify token request failed (${response.status})`);
    return data;
  }
  async function handleCallback() {
    const code = params.get('code'); const error = params.get('error');
    if (!code && !error) return;
    if (error) { localStorage.removeItem(KEYS.verifier); localStorage.removeItem(KEYS.state); history.replaceState({}, '', redirectUri); throw new Error(`Spotify authorization: ${error}`); }
    const expected = localStorage.getItem(KEYS.state); const verifier = localStorage.getItem(KEYS.verifier); const clientId = localStorage.getItem(KEYS.clientId);
    if (!expected || params.get('state') !== expected || !verifier || !clientId) { localStorage.removeItem(KEYS.verifier); localStorage.removeItem(KEYS.state); history.replaceState({}, '', redirectUri); throw new Error('Spotify sign-in state could not be verified. Please connect again.'); }
    const data = await tokenRequest({ client_id:clientId, grant_type:'authorization_code', code, redirect_uri:redirectUri, code_verifier:verifier });
    saveTokens(data); localStorage.removeItem(KEYS.verifier); localStorage.removeItem(KEYS.state);
    history.replaceState({}, '', redirectUri); message('Spotify connected successfully.');
  }
  async function accessToken(force = false) {
    let tokens = loadTokens(); if (!tokens?.access_token) return null;
    if (!force && Date.now() < tokens.expires_at) return tokens.access_token;
    if (!tokens.refresh_token) { clearAuth(); return null; }
    try {
      const data = await tokenRequest({ client_id:localStorage.getItem(KEYS.clientId) || '', grant_type:'refresh_token', refresh_token:tokens.refresh_token });
      tokens = saveTokens(data, tokens); return tokens.access_token;
    } catch (error) { if (/invalid_grant|refresh token/i.test(error.message)) clearAuth(); throw error; }
  }

  function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
  function message(text, error = false) { const node = $('authMessage'); if (!node) return; node.textContent = text; node.classList.toggle('error', error); }
  function setMarquee(id, text) { const node = $(id); if (!node) return; node.classList.remove('scroll'); node.innerHTML = ''; const span = document.createElement('span'); span.textContent = text; node.append(span); requestAnimationFrame(() => node.classList.toggle('scroll', span.scrollWidth > node.clientWidth + 2)); }
  function renderEmpty(title = 'Nothing playing', subtitle = 'Play something on Spotify') {
    setMarquee('trackName', title); setMarquee('artistName', subtitle); setMarquee('albumName', '—'); $('albumArt').hidden = true; $('albumArt').removeAttribute('src'); $('artFallback').hidden = false; $('coverBackdrop').classList.remove('visible'); $('coverBackdrop').style.backgroundImage = '';
  }
  function renderPlaying(item, playing) {
    const isEpisode = item.type === 'episode';
    const title = item.name || 'Unknown title';
    const artists = isEpisode ? (item.show?.name || 'Podcast') : (item.artists?.map(a => a.name).filter(Boolean).join(', ') || 'Unknown artist');
    const album = isEpisode ? (item.show?.name || 'Podcast') : (item.album?.name || 'Unknown album');
    const images = isEpisode ? item.images : item.album?.images; const image = images?.find(i => i?.url)?.url;
    setMarquee('trackName', title); setMarquee('artistName', artists); setMarquee('albumName', album);
    $('albumArt').hidden = !image; $('artFallback').hidden = Boolean(image);
    if (image && $('albumArt').src !== image) { $('albumArt').src = image; $('coverBackdrop').style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`; $('coverBackdrop').classList.add('visible'); }
  }
  async function pollNowPlaying() {
    if (pollInFlight) return;
    pollInFlight = true;
    clearTimeout(pollTimer); let delay = 7000;
    try {
      if (Date.now() < retryAfter) { delay = retryAfter - Date.now(); return; }
      const token = await accessToken();
      if (!token) { renderEmpty('Spotify not connected', 'Open the setup page'); delay = 15000; return; }
      let response = await fetch(SPOTIFY.nowPlaying, { headers:{ Authorization:`Bearer ${token}` }, cache:'no-store' });
      if (response.status === 401) {
        const refreshed = await accessToken(true);
        if (!refreshed) { renderEmpty('Spotify disconnected', 'Reconnect from setup'); delay = 15000; return; }
        response = await fetch(SPOTIFY.nowPlaying, { headers:{ Authorization:`Bearer ${refreshed}` }, cache:'no-store' });
      }
      if (response.status === 204) { renderEmpty(); return; }
      if (response.status === 429) { const seconds = Math.max(5, Number(response.headers.get('Retry-After')) || 10); retryAfter = Date.now() + seconds * 1000; delay = seconds * 1000; return; }
      if (!response.ok) throw new Error(`Spotify request failed (${response.status})`);
      const data = await response.json(); data.item ? renderPlaying(data.item, Boolean(data.is_playing)) : renderEmpty();
    } catch (error) { console.warn('Spotify update unavailable:', error.message); delay = 12000; }
    finally { pollInFlight = false; if (isDisplay) pollTimer = setTimeout(pollNowPlaying, Math.max(1000, delay)); }
  }

  function finiteTemp(value) { const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value); return Number.isFinite(n) && n > -20 && n < 150 ? Math.round(n) : null; }
  function temperature(device) {
    if (!device || typeof device !== 'object') return null;
    const keys = ['temperature','temp','temperatureC','temperatureCelsius','coreTemperature','packageTemperature'];
    for (const key of keys) { const value = finiteTemp(device[key]); if (value !== null) return value; }
    for (const key of ['stats','metrics','sensors']) { const nested = device[key]; if (nested && typeof nested === 'object') { const value = temperature(nested); if (value !== null) return value; } }
    return null;
  }
  function devices(value) { if (Array.isArray(value)) return value; if (value && typeof value === 'object') return Object.values(value); return []; }
  function chooseGpu(gpus) {
    return [...gpus].sort((a,b) => {
      const score = g => (g?.isActive || g?.active ? 100 : 0) + (g?.isDiscrete || /nvidia|radeon|geforce|arc/i.test(g?.name || g?.model || '') ? 50 : 0) + (Number(g?.load ?? g?.usage ?? g?.utilization) || 0);
      return score(b) - score(a);
    }).find(g => temperature(g) !== null);
  }
  function monitoringUpdate(data) {
    try { const cpus = devices(data?.cpus ?? data?.cpu); const gpus = devices(data?.gpus ?? data?.gpu); const cpu = cpus.find(c => temperature(c) !== null); const gpu = chooseGpu(gpus); setText('cpuTemp', temperature(cpu) ?? '--'); setText('gpuTemp', temperature(gpu) ?? '--'); }
    catch (error) { console.warn('Monitoring update ignored:', error.message); }
  }
  function installMonitoring() {
    window.nzxt = window.nzxt || {}; window.nzxt.v1 = window.nzxt.v1 || {};
    window.nzxt.v1.onMonitoringDataUpdate = monitoringUpdate;
    if (isPreview) { let tick = 0; monitoringUpdate({ cpus:[{temperature:47}], gpus:[{temperature:43,isActive:true,isDiscrete:true}] }); setInterval(() => { tick += .2; monitoringUpdate({ cpus:[{temperature:48 + Math.sin(tick)*4}], gpus:[{temperature:43 + Math.cos(tick*.8)*3,isActive:true,isDiscrete:true}] }); }, 2000); }
  }
  function tickClock() {
    const parts = new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type)?.value || '';
    setText('clockTime', `${value('hour')}:${value('minute')}`);
    setText('clockPeriod', value('dayPeriod').toUpperCase());
  }
  function setupConfig() {
    $('dashboard').hidden = true; $('config').hidden = false; $('clientId').value = localStorage.getItem(KEYS.clientId) || ''; $('redirectUri').value = redirectUri;
    $('krakenUrl').textContent = `${redirectUri}?kraken=1`; $('previewLink').href = `${redirectUri}?preview=1`;
    const refreshStatus = () => { const connected = Boolean(loadTokens()?.refresh_token || loadTokens()?.access_token); setText('configSpotifyStatus', connected ? 'Connected' : 'Not connected'); $('disconnectSpotify').hidden = !connected; };
    $('saveClient').onclick = () => { const value=$('clientId').value.trim(); if (value) { localStorage.setItem(KEYS.clientId,value); message('Client ID saved.'); } else message('Enter a Client ID.',true); };
    $('copyRedirect').onclick = async () => { try { await navigator.clipboard.writeText(redirectUri); message('Redirect URI copied.'); } catch { $('redirectUri').select(); message('Press Ctrl+C to copy the selected URI.'); } };
    $('connectSpotify').onclick = () => connect().catch(e => message(e.message,true));
    $('disconnectSpotify').onclick = () => { clearAuth(); refreshStatus(); message('Spotify disconnected on this browser.'); };
    handleCallback().then(refreshStatus).catch(e => { message(e.message,true); refreshStatus(); });
    window.addEventListener('storage', refreshStatus); refreshStatus();
  }
  function setupDisplay() {
    document.body.classList.add('lcd'); $('config').hidden = true; $('dashboard').hidden = false; tickClock(); setInterval(tickClock,1000); installMonitoring(); pollNowPlaying();
    $('albumArt').addEventListener('error', () => { $('albumArt').hidden = true; $('artFallback').hidden = false; $('coverBackdrop').classList.remove('visible'); $('coverBackdrop').style.backgroundImage = ''; });
    window.addEventListener('storage', e => { if ([KEYS.tokens,KEYS.clientId].includes(e.key)) pollNowPlaying(); });
    window.addEventListener('online', pollNowPlaying);
  }
  window.addEventListener('error', e => console.warn('Dashboard error:', e.message));
  window.addEventListener('unhandledrejection', e => { console.warn('Dashboard promise rejected:', e.reason?.message || e.reason); e.preventDefault(); });
  isDisplay ? setupDisplay() : setupConfig();
})();
