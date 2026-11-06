(function () {
  var requestForm = document.getElementById("otp-request");
  var verifyForm = document.getElementById("otp-verify");
  var status = document.getElementById("form-status");
  var back = document.getElementById("otp-back");
  if (!requestForm || !verifyForm || !status) return;

  var phone = "";

  function say(message) {
    status.textContent = message;
  }

  async function post(url, body) {
    var response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    var data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    return { ok: response.ok, status: response.status, data: data };
  }

  requestForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var input = document.getElementById("phone");
    phone = input.value.trim();
    say("Sending the code…");
    post("/api/auth/otp/request", { phone: phone }).then(function (result) {
      if (!result.ok) {
        say(result.data.error || "The code could not be sent.");
        return;
      }
      phone = result.data.phone || phone;
      requestForm.hidden = true;
      verifyForm.hidden = false;
      say("Enter the 6-digit code sent to " + phone + ".");
      document.getElementById("code").focus();
    }).catch(function () {
      say("The code could not be sent. Check your connection and try again.");
    });
  });

  verifyForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var code = document.getElementById("code").value.trim();
    say("Checking the code…");
    post("/api/auth/otp/verify", { phone: phone, code: code }).then(function (result) {
      if (!result.ok) {
        say(result.data.error || "That code was not accepted.");
        return;
      }
      window.location.href = "/portal";
    }).catch(function () {
      say("Sign-in could not be completed. Try again.");
    });
  });

  if (back) {
    back.addEventListener("click", function () {
      verifyForm.hidden = true;
      requestForm.hidden = false;
      say("");
      document.getElementById("phone").focus();
    });
  }
})();
