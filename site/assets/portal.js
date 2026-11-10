(function () {
  var requestForm = document.getElementById("otp-request");
  var verifyForm = document.getElementById("otp-verify");
  var status = document.getElementById("form-status");
  var back = document.getElementById("otp-back");
  var booking = document.getElementById("booking-form");
  var locate = document.getElementById("use-location");

  var phone = "";

  function say(message) {
    if (status) status.textContent = message;
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

  if (requestForm && verifyForm && status) requestForm.addEventListener("submit", function (event) {
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

  if (verifyForm && status) verifyForm.addEventListener("submit", function (event) {
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

  if (back && requestForm && verifyForm) {
    back.addEventListener("click", function () {
      verifyForm.hidden = true;
      requestForm.hidden = false;
      say("");
      document.getElementById("phone").focus();
    });
  }

  if (locate) {
    locate.addEventListener("click", function () {
      var note = document.getElementById("location-note");
      if (!navigator.geolocation) {
        note.textContent = "This phone cannot share its location. The address is enough.";
        return;
      }
      note.textContent = "Asking for this phone's location…";
      navigator.geolocation.getCurrentPosition(function (position) {
        document.getElementById("lat").value = String(position.coords.latitude);
        document.getElementById("lng").value = String(position.coords.longitude);
        note.textContent = "Location saved for this request.";
      }, function () {
        note.textContent = "Location was not shared. The address is enough.";
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  if (booking && status) {
    booking.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(booking);
      var when = document.getElementById("preferredTime");
      if (when && when.value) data.set("preferredTime", String(new Date(when.value).getTime()));
      say("Sending the request…");
      fetch("/api/jobs", { method: "POST", headers: { accept: "application/json" }, body: data }).then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok) {
          say(result.body.error || "The request could not be sent.");
          return;
        }
        window.location.href = result.body.path || "/portal/client";
      }).catch(function () {
        say("The request could not be sent. Check your connection and try again.");
      });
    });
  }
})();
