// Nuru & Maji site script
// Set your WhatsApp number here: country code + number, no "+" or spaces.
var WHATSAPP_NUMBER = "2547YOURNUMBER";
var EMAIL = "hello@nurumaji.co.ke";

(function () {
  // Mobile menu
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("site-nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Close" : "Menu";
    });
  }

  // Footer year
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();

  // Booking form
  var form = document.getElementById("booking");
  if (!form) return;

  var params = new URLSearchParams(window.location.search);
  if (params.get("service") === "care") {
    var sel = document.getElementById("f-service");
    if (sel) sel.value = "Care plan enquiry";
  }

  function message() {
    var f = form.elements;
    return [
      "Hello Nuru & Maji, I'd like to book a technician.",
      "",
      "Name: " + f.name.value.trim(),
      "Phone: " + f.phone.value.trim(),
      "Area: " + f.area.value.trim(),
      "Service: " + f.service.value,
      "Urgency: " + f.urgency.value,
      f.details.value.trim() ? "Details: " + f.details.value.trim() : ""
    ].join("\n").trim();
  }

  function validate() {
    var ok = true, first = null;
    ["f-name", "f-phone", "f-area"].forEach(function (id) {
      var el = document.getElementById(id);
      var err = document.getElementById(id + "-err");
      var bad = !el.value.trim() || (id === "f-phone" && el.value.replace(/\D/g, "").length < 9);
      el.setAttribute("aria-invalid", bad ? "true" : "false");
      if (bad) { el.setAttribute("aria-describedby", id + "-err"); } else { el.removeAttribute("aria-describedby"); }
      err.hidden = !bad;
      if (bad && !first) first = el;
      if (bad) ok = false;
    });
    if (first) first.focus();
    return ok;
  }

  var status = document.getElementById("booking-status");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) { status.textContent = "Check the highlighted fields."; return; }
    var url = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(message());
    status.textContent = "Opening WhatsApp with your booking. Press send there to confirm.";
    window.open(url, "_blank", "noopener");
  });

  var alt = document.getElementById("email-alt");
  if (alt) {
    alt.addEventListener("click", function (e) {
      if (!validate()) { e.preventDefault(); status.textContent = "Check the highlighted fields."; return; }
      alt.href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Booking request") + "&body=" + encodeURIComponent(message());
      status.textContent = "Opening your email app with the booking filled in.";
    });
  }
})();
