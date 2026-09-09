/* ============================================================
   AGENT AUTH — the backend sets a separate httpOnly `agentToken`
   cookie on agent login (distinct from the buyer/seller/admin
   `token` cookie — see middleware/agentAuthMiddleware.js), so an
   agent session and a marketplace account session can coexist in
   the same browser. We keep a small, non-authoritative copy of
   the agent's profile in localStorage purely for UI.
   ============================================================ */

const SS_AGENT_AUTH = (() => {
  const KEY = "ss_agent";

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY)); }
    catch (_) { return null; }
  }

  function set(agent) {
    localStorage.setItem(KEY, JSON.stringify(agent));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function isLoggedIn() {
    return !!get();
  }

  // Redirects to the login page if there's no cached agent. This is a UI
  // convenience only — the real gate is the backend's protectAgent
  // middleware; every SS_AGENT_API call still gets a fresh 401 check.
  function require() {
    const agent = get();
    if (!agent) {
      location.href = "agent-login.html";
      return null;
    }
    return agent;
  }

  return { get, set, clear, isLoggedIn, require };
})();