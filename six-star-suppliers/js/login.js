/* ============================================================
   SIX STAR SUPPLIERS — Login
   Cookie-based authentication
   ============================================================ */

document.getElementById("loginForm").addEventListener("submit", async e => {

  e.preventDefault();

  const errBox = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");


  errBox.classList.remove("show");


  btn.disabled = true;
  btn.textContent = "Logging in…";


  try {


    const res = await SS_API.login({

      email: document
        .getElementById("email")
        .value
        .trim(),

      password: document
        .getElementById("password")
        .value

    });



    console.log(
      "Login response:",
      res
    );



    const user = res.user;



    if (!user) {
      throw new Error(
        "Login successful but user data was not returned."
      );
    }



    // Store user details only
    // Authentication is handled by httpOnly cookie
    SS_AUTH.set(user);



    console.log(
      "User saved:",
      user
    );



    ssToast(
      "Logged in successfully",
      "fa-circle-check"
    );



    // Redirect according to role

    const redirect =
      new URLSearchParams(location.search)
      .get("redirect");



    let target;



    if (redirect) {

      target = redirect;

    } else {


      switch(user.role) {


        case "wholesaler":

        case "retailer":

          target = "/six-star-suppliers/seller-dashboard.html";

          break;



        case "buyer":

          target = "/index.html";

          break;



        case "admin":

          target = "/site/admin-dashboard.html";

          break;



        default:

          target = "/index.html";

      }

    }



    console.log(
      "Redirecting to:",
      target
    );



    location.href = target;



  } catch(err) {


    console.error(
      "Login error:",
      err
    );


    errBox.textContent =
      err.message ||
      "Login failed. Check your details and try again.";


    errBox.classList.add("show");


    btn.disabled = false;

    btn.textContent = "Log in";


  }

});