(function () {
  var params = new URLSearchParams(location.search);
  var invite = params.get("invite") || "";
  var marketing = document.getElementById("join-marketing");
  var apply = document.getElementById("join-apply");
  var status = document.getElementById("join-status");
  var phone = "";
  var application = null;
  var documents = [];
  var loginPhone = "";
  var order = ["otp", "personal", "trade", "licences", "uploads", "coverage", "payout", "references"];

  function say(message) { if (status) status.textContent = message; }

  function show(step) {
    order.forEach(function (name) {
      var panel = document.getElementById("step-" + name);
      if (panel) panel.hidden = name !== step;
    });
    var done = document.getElementById("step-done");
    if (done) done.hidden = step !== "done";
    document.querySelectorAll("#step-list li").forEach(function (item) {
      item.classList.toggle("current", item.getAttribute("data-step") === step);
    });
  }

  async function send(url, method, body, form) {
    var options = { method: method, headers: { accept: "application/json" } };
    if (form) options.body = form;
    else if (body) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    var response = await fetch(url, options);
    var data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    return { ok: response.ok, data: data };
  }

  function openFor(step) {
    if (!application) return step === "otp";
    if (application.status === "draft") return true;
    if (application.status === "needs_info") return (application.reopen || []).indexOf(step) !== -1;
    return false;
  }

  function nextOpen(from) {
    for (var i = order.indexOf(from); i < order.length; i += 1) {
      if (openFor(order[i])) return order[i];
    }
    return "done";
  }

  function setValue(id, value) {
    var field = document.getElementById(id);
    if (field && value) field.value = value;
  }

  function checkValues(name, values) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = values.indexOf(input.value) !== -1;
    });
  }

  function checked(name) {
    return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (input) {
      return input.value;
    });
  }

  function fill() {
    if (!application) return;
    var personal = application.personal || {};
    setValue("full-name", personal.fullName);
    setValue("email", personal.email);
    setValue("dob", personal.dateOfBirth);
    setValue("id-number", personal.idNumber);
    setValue("kra", personal.kraPin);
    setValue("area", personal.area);
    setValue("years", application.experienceYears == null ? "" : String(application.experienceYears));
    setValue("epra-class", personal.epraClass);
    setValue("good-conduct", personal.goodConductIssued);
    setValue("lat", application.baseLat == null ? "" : String(application.baseLat));
    setValue("lng", application.baseLng == null ? "" : String(application.baseLng));
    setValue("radius", application.radiusKm == null ? "" : String(application.radiusKm));
    setValue("mpesa", application.mpesa || loginPhone);
    checkValues("trade", (application.trades || "").split(","));
    checkValues("specialism", (application.specialisms || "").split(","));
    var tools = document.querySelector('input[name="tools"][value="' + (application.tools ? "yes" : "no") + '"]');
    if (application.transport && tools) tools.checked = true;
    var transport = document.querySelector('input[name="transport"][value="' + application.transport + '"]');
    if (transport) transport.checked = true;
    var hours = application.availability || {};
    checkValues("day", hours.days || []);
    if (hours.start) setValue("start-time", hours.start);
    if (hours.end) setValue("end-time", hours.end);
    var list = document.getElementById("file-list");
    list.textContent = "";
    documents.forEach(function (doc) {
      if (!doc.hasFile) return;
      var item = document.createElement("li");
      item.textContent = String(doc.docType || "").replaceAll("_", " ");
      list.appendChild(item);
    });
    documents.forEach(function (doc) {
      if (doc.docType === "epra_licence" && doc.number) {
        setValue("epra-number", doc.number);
        setValue("epra-expiry", doc.expiryDate);
      }
    });
  }

  async function begin() {
    var me = await send("/api/me", "GET");
    if (!me.ok) { show("otp"); return; }
    loginPhone = me.data.phone || "";
    var payloadInvite = invite;
    invite = "";
    var started = await send("/api/join/start", "POST", { invite: payloadInvite });
    if (!started.ok && started.data.error) say(started.data.error);
    await refresh(started.ok ? "personal" : "done");
  }

  async function refresh(preferred) {
    var current = await send("/api/join/me", "GET");
    if (!current.ok) { show("otp"); return; }
    application = current.data.application;
    documents = current.data.documents || [];
    if (!application) { show("otp"); return; }
    fill();
    if (application.status === "submitted" || application.status === "approved" || application.status === "rejected" || application.status === "probation") {
      document.getElementById("step-done").textContent = "Status: " + application.status + (application.decision ? ". " + application.decision : "");
      show("done");
      return;
    }
    if (application.status === "needs_info") {
      say(application.decision || "A reviewer asked for a correction.");
      var correction = nextOpen(preferred || "personal");
      if (correction === "done") {
        var donePanel = document.getElementById("step-done");
        donePanel.textContent = "";
        var again = document.createElement("button");
        again.className = "btn btn-amber";
        again.type = "button";
        again.textContent = "Submit corrections";
        again.addEventListener("click", function () {
          send("/api/join/submit", "POST", {}).then(function (result) {
            if (!result.ok) return say(result.data.error || "The correction was not submitted.");
            say("");
            refresh("done");
          });
        });
        donePanel.appendChild(again);
        show("done");
        return;
      }
      show(correction);
      return;
    }
    show(openFor(preferred) ? preferred : nextOpen(preferred || "personal"));
  }

  if (invite && marketing && apply) {
    marketing.hidden = true;
    apply.hidden = false;
    begin();
  }

  document.getElementById("apply-now").addEventListener("click", function () {
    marketing.hidden = true;
    apply.hidden = false;
    begin();
  });

  document.getElementById("otp-request").addEventListener("submit", function (event) {
    event.preventDefault();
    phone = document.getElementById("phone").value.trim();
    say("Sending the code…");
    send("/api/auth/otp/request", "POST", { phone: phone }).then(function (result) {
      if (!result.ok) return say(result.data.error || "The code could not be sent.");
      phone = result.data.phone || phone;
      document.getElementById("otp-request").hidden = true;
      document.getElementById("otp-verify").hidden = false;
      document.getElementById("otp-back").hidden = false;
      say("Enter the 6-digit code.");
    });
  });

  document.getElementById("otp-verify").addEventListener("submit", function (event) {
    event.preventDefault();
    send("/api/auth/otp/verify", "POST", { phone: phone, code: document.getElementById("code").value.trim() }).then(function (result) {
      if (!result.ok) return say(result.data.error || "That code was not accepted.");
      say("");
      begin();
    });
  });

  document.getElementById("otp-back").addEventListener("click", function () {
    document.getElementById("otp-verify").hidden = true;
    document.getElementById("otp-back").hidden = true;
    document.getElementById("otp-request").hidden = false;
  });

  document.getElementById("step-personal").addEventListener("submit", function (event) {
    event.preventDefault();
    send("/api/join/personal", "PUT", {
      fullName: document.getElementById("full-name").value,
      email: document.getElementById("email").value,
      dateOfBirth: document.getElementById("dob").value,
      idNumber: document.getElementById("id-number").value,
      kraPin: document.getElementById("kra").value,
      area: document.getElementById("area").value,
    }).then(function (result) {
      if (!result.ok) return say(result.data.error || "Check those details.");
      say("");
      refresh("trade");
    });
  });

  document.getElementById("step-trade").addEventListener("submit", function (event) {
    event.preventDefault();
    var tools = document.querySelector('input[name="tools"]:checked');
    var transport = document.querySelector('input[name="transport"]:checked');
    send("/api/join/trade", "PUT", {
      trades: checked("trade"),
      experienceYears: document.getElementById("years").value,
      specialisms: checked("specialism"),
      tools: Boolean(tools && tools.value === "yes"),
      transport: transport ? transport.value : "",
    }).then(function (result) {
      if (!result.ok) return say(result.data.error || "Check the trade details.");
      say("");
      refresh("licences");
    });
  });

  document.getElementById("step-licences").addEventListener("submit", function (event) {
    event.preventDefault();
    send("/api/join/licences", "PUT", {
      epraNumber: document.getElementById("epra-number").value,
      epraClass: document.getElementById("epra-class").value,
      epraExpiry: document.getElementById("epra-expiry").value,
      ncaNumber: document.getElementById("nca-number").value,
      goodConductIssued: document.getElementById("good-conduct").value,
    }).then(function (result) {
      if (!result.ok) return say(result.data.error || "Check the licence details.");
      say("");
      refresh("uploads");
    });
  });

  document.getElementById("step-uploads").addEventListener("submit", function (event) {
    event.preventDefault();
    var file = document.getElementById("doc-file").files[0];
    if (!file) return;
    var form = new FormData();
    form.set("docType", document.getElementById("doc-type").value);
    form.set("file", file);
    say("Uploading…");
    send("/api/join/documents", "POST", null, form).then(function (result) {
      if (!result.ok) return say(result.data.error || "That file was not accepted.");
      document.getElementById("doc-file").value = "";
      say("File saved.");
      refresh("uploads");
    });
  });

  document.getElementById("uploads-next").addEventListener("click", function () { refresh("coverage"); });

  document.getElementById("use-location").addEventListener("click", function () {
    var note = document.getElementById("location-note");
    if (!navigator.geolocation) {
      note.textContent = "This phone cannot share its location. Type the latitude and longitude.";
      return;
    }
    note.textContent = "Asking for this phone's location…";
    navigator.geolocation.getCurrentPosition(function (position) {
      document.getElementById("lat").value = String(position.coords.latitude);
      document.getElementById("lng").value = String(position.coords.longitude);
      note.textContent = "Location added.";
    }, function () {
      note.textContent = "Location was not shared. Type the latitude and longitude.";
    });
  });

  document.getElementById("step-coverage").addEventListener("submit", function (event) {
    event.preventDefault();
    send("/api/join/coverage", "PUT", {
      baseLat: document.getElementById("lat").value,
      baseLng: document.getElementById("lng").value,
      radiusKm: document.getElementById("radius").value,
      days: checked("day"),
      start: document.getElementById("start-time").value,
      end: document.getElementById("end-time").value,
    }).then(function (result) {
      if (!result.ok) return say(result.data.error || "Check the coverage details.");
      say("");
      refresh("payout");
    });
  });

  document.getElementById("step-payout").addEventListener("submit", function (event) {
    event.preventDefault();
    send("/api/join/payout", "PUT", { mpesa: document.getElementById("mpesa").value }).then(function (result) {
      if (!result.ok) return say(result.data.error || "Check the M-Pesa number.");
      say("");
      refresh("references");
    });
  });

  document.getElementById("step-references").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!document.getElementById("terms").checked) return say("Agree to the terms to submit.");
    send("/api/join/submit", "POST", {
      terms: true,
      references: [
        { name: document.getElementById("ref1-name").value, phone: document.getElementById("ref1-phone").value },
        { name: document.getElementById("ref2-name").value, phone: document.getElementById("ref2-phone").value },
      ],
    }).then(function (result) {
      if (!result.ok) return say(result.data.error || "The application was not submitted.");
      say("");
      refresh("done");
    });
  });
})();
