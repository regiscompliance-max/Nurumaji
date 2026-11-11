(function () {
  var el = document.getElementById("ops-map");
  if (!el || !window.L) return;
  var map = window.L.map(el, { scrollWheelZoom: false }).setView([-1.286389, 36.817223], 12);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  var layer = window.L.layerGroup().addTo(map);
  var colours = { standard: "#10242E", urgent: "#C4A35A", emergency: "#8E1D1D" };

  function minutesAgo(updatedAt) {
    var mins = Math.max(0, Math.round((Date.now() / 1000 - updatedAt) / 60));
    return mins === 1 ? "1 min ago" : mins + " min ago";
  }

  function draw(data) {
    layer.clearLayers();
    var bounds = [];
    (data.jobs || []).forEach(function (job) {
      if (job.lat == null || job.lng == null) return;
      var colour = colours[job.urgency] || "#10242E";
      window.L.circleMarker([job.lat, job.lng], { radius: 9, color: colour, fillColor: colour, fillOpacity: 0.9, weight: 1 })
        .bindPopup(job.trade + " · " + job.urgency + " · " + job.status)
        .addTo(layer);
      bounds.push([job.lat, job.lng]);
    });
    (data.technicians || []).forEach(function (tech) {
      window.L.circleMarker([tech.lat, tech.lng], { radius: 8, color: "#1F5C62", fillColor: "#6AA8A4", fillOpacity: 0.95, weight: 2 })
        .bindPopup(tech.name + " · last seen " + minutesAgo(tech.updatedAt))
        .addTo(layer);
      bounds.push([tech.lat, tech.lng]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  }

  function load() {
    fetch("/api/operator/map", { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { if (data) draw(data); })
      .catch(function () {});
  }

  load();
  setInterval(load, 30000);
  setTimeout(function () { map.invalidateSize(); }, 200);
})();
