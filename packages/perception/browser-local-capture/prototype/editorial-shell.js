const onReady = (fn) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
};

onReady(() => {
  const badges = [...document.querySelectorAll('.dq-brand-row .dq-header-badges > .dq-badge')];
  const modes = [
    { label: 'Ask', selected: true, disabled: false },
    { label: 'Watch', selected: false, disabled: true },
    { label: 'Microscope', selected: false, disabled: true },
  ];

  badges.slice(0, 3).forEach((badge, index) => {
    const mode = modes[index];
    if (!mode) return;
    badge.setAttribute('role', 'tab');
    badge.setAttribute('aria-label', mode.label);
    badge.setAttribute('aria-selected', String(mode.selected));
    badge.setAttribute('tabindex', mode.selected ? '0' : '-1');
    if (mode.disabled) badge.setAttribute('aria-disabled', 'true');
  });

  const modeRail = document.querySelector('.dq-header-badges');
  if (modeRail) {
    modeRail.setAttribute('role', 'tablist');
    modeRail.setAttribute('aria-label', 'Perception modes');
  }

  const cameraTitle = document.getElementById('cameraTitle');
  if (cameraTitle) cameraTitle.setAttribute('aria-label', 'Ask the World');

  const startCamera = document.getElementById('startCamera');
  if (startCamera) startCamera.setAttribute('aria-label', 'Start conversation and start camera');

  const analyzeMovement = document.getElementById('analyzeMovement');
  if (analyzeMovement) analyzeMovement.setAttribute('aria-label', 'Ask the world about the next movement');

  const movementTitle = document.getElementById('movementResultTitle');
  if (movementTitle) movementTitle.setAttribute('aria-label', 'Live Exchange');

  const history = document.querySelector('#movementHistoryPanel > summary');
  if (history) history.setAttribute('aria-label', 'View all moments');

  // Advanced tooling stays out of the consumer surface but remains available
  // to the local operator without changing the application state machine.
  document.addEventListener('keydown', (event) => {
    if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'd')) return;
    const enabled = document.body.dataset.devTools === 'true';
    if (enabled) {
      delete document.body.dataset.devTools;
    } else {
      document.body.dataset.devTools = 'true';
      document.getElementById('developerTools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
