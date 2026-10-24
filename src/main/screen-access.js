// macOS shows its Screen Recording prompt on every capture attempt until the user allows it,
// and a new permission only applies after the app restarts. So ask once per launch, then stop
// trying, instead of letting every scan re-open the prompt.
//
// getStatus() returns macOS's status ('granted' when allowed); probe() makes one capture
// attempt, which is what makes macOS show its prompt.
function createScreenAccess({ isMac, getStatus, probe }) {
  let prompted = false;
  return async function screenAccess() {
    if (!isMac || getStatus() === 'granted') return 'granted';
    if (prompted) return 'denied';
    prompted = true;
    try {
      await probe();
    } catch (_) { /* only the prompt matters here */ }
    return getStatus() === 'granted' ? 'granted' : 'denied';
  };
}

module.exports = { createScreenAccess };
