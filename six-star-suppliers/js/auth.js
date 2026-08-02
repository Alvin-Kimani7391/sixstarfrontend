/* ============================================================
   SIX STAR SUPPLIERS — session helper
   Cookie-based authentication
   User data is cached locally for UI only.
   Authentication is verified by backend /auth/me.
   ============================================================ */

const SS_AUTH = {

  KEY: "ss_user",


  // Save user details for UI
  set(user) {
    localStorage.setItem(
      this.KEY,
      JSON.stringify(user)
    );
  },


  // Get cached user
  get() {
    try {
      return JSON.parse(
        localStorage.getItem(this.KEY)
      ) || null;

    } catch {
      return null;
    }
  },


  // Clear local session data
  clear() {
    localStorage.removeItem(this.KEY);
  },


  // Check if we have cached user data
  isLoggedIn() {
    return !!this.get();
  },


  /*
    Verify authentication with backend.

    The browser automatically sends:
    token=httpOnly-cookie

    because api.js uses:
    credentials:"include"
  */
  async checkSession() {

    try {

      console.log("Calling backend /auth/me");

const response = await SS_API.getMe();

console.log("Backend response:", response);

if (response.user) {

        this.set(response.user);

        return response.user;

      }


      return null;


    } catch(error) {

      this.clear();

      return null;

    }

  },


  /*
    Protect pages by role.

    Example:
    SS_AUTH.requireRole([
        "wholesaler",
        "retailer"
    ])
  */
  async requireRole(roles = []) {

    console.log(
      "Checking authentication..."
    );


    const user = await this.checkSession();


    if (!user) {

  console.warn(
    "No active session. Redirect blocked for debugging."
  );

  return null;

}



    console.log(
      "Authenticated:",
      user.email,
      user.role
    );



    // Role protection

    if (
      roles.length &&
      !roles.includes(user.role)
    ) {

      console.warn(
        "Role not allowed:",
        user.role
      );


      location.href = "/index.html";


      return null;

    }


    return user;

  }

};