const sessions = {};

function get(businessId, phone) {
  const key = `${businessId}_${phone}`;

  if (!sessions[key]) {
    sessions[key] = { step: "idle" };
  }

  return sessions[key];
}

module.exports = { get };