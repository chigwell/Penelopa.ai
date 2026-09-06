'use strict';
const path = require('node:path');
const { home, readJson, writeJson, credential, installState, fingerprint } = require('./files.cjs');
class AuthSession {
  constructor(storage, root = home()) { this.storage = storage; this.root = root; this.file = path.join(root, 'auth.json'); this.token = null; this.error = null; this.signedOut = false; }
  async initialise() {
    if (installState(this.root)?.desktopAllowed === false) return this.signOut('This installation uses custom endpoints. Desktop supports the production Penelopa account only.');
    let saved;
    try { saved = readJson(this.file, null); } catch { this.signedOut = true; this.error = 'Saved sign-in data could not be read. Reconnect your installed account.'; return this.state(); }
    this.signedOut = saved?.signedOut === true;
    if (this.signedOut) return this.state();
    if (saved?.encryptedToken) {
      try { this.token = this.storage.decryptString(Buffer.from(saved.encryptedToken, 'base64')); return this.state(); }
      catch { this.error = 'Keychain access needs attention. Reconnect your installed account.'; return this.state(); }
    }
    return this.connect();
  }
  async connect() {
    const install = installState(this.root);
    if (install?.desktopAllowed === false) return this.signOut('Desktop is unavailable for custom endpoints.');
    const token = credential(install);
    if (!token) { this.error = 'No installed account was found. Run the installer or repair your connection.'; return this.state(); }
    this.token = token; this.error = null; this.signedOut = false;
    if (this.storage.isEncryptionAvailable()) {
      try { writeJson(this.file, { signedOut: false, fingerprint: fingerprint(token), encryptedToken: this.storage.encryptString(token).toString('base64') }); }
      catch { this.error = 'Secure storage is unavailable. This session is in memory only.'; }
    } else this.error = 'Secure storage is unavailable. This session is in memory only.';
    return this.state();
  }
  signOut(error = null) { this.token = null; this.error = error; this.signedOut = true; writeJson(this.file, { signedOut: true }); return this.state(); }
  state() { return { authenticated: !!this.token, signedOut: this.signedOut, ...(this.error ? { error: this.error } : {}) }; }
}
module.exports = { AuthSession };
