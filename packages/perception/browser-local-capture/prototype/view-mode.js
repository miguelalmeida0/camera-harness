(() => {
  const params = new URLSearchParams(location.search);
  const advanced = params.get("advanced") === "1" || /\/advanced\/?$/.test(location.pathname);
  document.body.dataset.view = advanced ? "advanced" : "primary";
})();
