(function () {
  var details = document.getElementById("book-details");
  var verify = document.getElementById("book-verify");
  var status = document.getElementById("book-status");
  if (!details || !verify || !status) return;

  var params = new URLSearchParams(window.location.search);
  var serviceField = document.getElementById("service");
  if (serviceField && params.get("service")) serviceField.value = params.get("service");
  var urgencyField = document.getElementById("urgency");
  if (urgencyField && params.get("urgency") && urgencyField.querySelector("option[value='" + params.get("urgency") + "']")) {
    urgencyField.value = params.get("urgency");
  }

  fetch("/api/me", { headers: { accept: "application/json" } }).then(function (response) {
    if (response.ok) window.location.replace("/portal/book" + window.location.search);
  }).catch(function () {});

  var phone = "";
  var name = "";
  var service = "";
  var description = "";

  function say(message) { status.textContent = message; }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { ok: response.ok, data: data };
      });
    });
  }

  details.addEventListener("submit", function (event) {
    event.preventDefault();
    name = document.getElementById("name").value.trim();
    phone = document.getElementById("phone").value.trim();
    service = document.getElementById("service").value;
    description = document.getElementById("description").value.trim();
    say("Sending the code…");
    post("/api/auth/otp/request", { phone: phone }).then(function (result) {
      if (!result.ok) { say(result.data.error || "The code could not be sent."); return; }
      phone = result.data.phone || phone;
      details.hidden = true;
      verify.hidden = false;
      say("Enter the 6-digit code sent to " + phone + ".");
      document.getElementById("code").focus();
    }).catch(function () {
      say("The code could not be sent. Check your connection and try again.");
    });
  });

  verify.addEventListener("submit", function (event) {
    event.preventDefault();
    var code = document.getElementById("code").value.trim();
    say("Checking the code…");
    post("/api/auth/otp/verify", { phone: phone, code: code }).then(function (result) {
      if (!result.ok) { say(result.data.error || "That code was not accepted."); return null; }
      return post("/api/me", { name: name });
    }).then(function (result) {
      if (!result) return null;
      if (!result.ok) { say(result.data.error || "Your name could not be saved."); return null; }
      var chosenUrgency = urgencyField ? urgencyField.value : "standard";
      if (chosenUrgency !== "urgent" && chosenUrgency !== "emergency") chosenUrgency = "standard";
      var consent = document.getElementById("photo-consent");
      return post("/api/jobs", { service: service, description: description, urgency: chosenUrgency, photoConsent: consent && consent.checked ? "1" : "" });
    }).then(function (result) {
      if (!result) return;
      if (!result.ok) { say(result.data.error || "The request could not be saved."); return; }
      window.location.href = result.data.path || "/portal/client";
    }).catch(function () {
      say("The request could not be completed. Try again.");
    });
  });
})();
