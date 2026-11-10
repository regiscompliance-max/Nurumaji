// Nuru & Maji site script
// The contact form still prepares an email. WhatsApp links are separate.
var WHATSAPP_NUMBER = "";
var EMAIL = "hello@nurumaji.co.ke";

(function () {
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("site-nav");
  var head = document.querySelector(".site-head");
  if (btn && nav) {
    function focusable() {
      return [btn].concat(Array.prototype.slice.call(nav.querySelectorAll("a, button")));
    }
    function closeMenu() {
      nav.classList.remove("open");
      document.body.classList.remove("nav-open");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "Menu";
    }
    function openMenu() {
      nav.classList.add("open");
      document.body.classList.add("nav-open");
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Close";
      var first = nav.querySelector("a");
      if (first) first.focus();
    }
    btn.addEventListener("click", function () {
      if (nav.classList.contains("open")) closeMenu();
      else openMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (!nav.classList.contains("open")) return;
      if (e.key === "Escape") {
        closeMenu();
        btn.focus();
        return;
      }
      if (e.key !== "Tab") return;
      var nodes = focusable();
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeMenu();
    });
  }
  if (head) {
    var compact = function () { head.classList.toggle("is-compact", window.scrollY > 12); };
    compact();
    window.addEventListener("scroll", compact, { passive: true });
  }

  var whatsappFloat = document.querySelector(".wa-float");
  if (whatsappFloat && !whatsappFloat.getAttribute("href")) whatsappFloat.hidden = true;

  // Footer year
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();

  // Booking form
  var form = document.getElementById("booking");
  if (!form) return;

  var params = new URLSearchParams(window.location.search);
  var sel = document.getElementById("f-service");
  var serviceMap = {
    care: "Care plan enquiry",
    safety: "Building safety check",
    tripping: "Electrical fault or repair",
    sockets: "Electrical fault or repair",
    lighting: "Lighting",
    heater: "Water heater or shower",
    leak: "Plumbing leak or repair",
    drain: "Blocked drain or toilet",
    tanks: "Tanks, pumps or pressure",
    solar: "Solar or backup power"
  };
  if (sel && serviceMap[params.get("service")]) sel.value = serviceMap[params.get("service")];

  function message() {
    var f = form.elements;
    return [
      "Hello Nuru & Maji, I'd like to book a technician.",
      "",
      "Name: " + f.name.value.trim(),
      "Phone: " + f.phone.value.trim(),
      "Area: " + f.area.value.trim(),
      f.who && f.who.value ? "Who: " + f.who.value : "",
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
    if (WHATSAPP_NUMBER) {
      var url = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(message());
      status.textContent = "Opening WhatsApp with your booking. Press send there to confirm.";
      window.open(url, "_blank", "noopener");
    } else {
      var emailUrl = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Booking request") + "&body=" + encodeURIComponent(message());
      status.textContent = "Opening your email app with the booking filled in.";
      window.location.href = emailUrl;
    }
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
