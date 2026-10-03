// Sub-path par deploy (jaise example.com/fixmyseo): build ke waqt NEXT_PUBLIC_BASE_PATH=/fixmyseo do.
// Local mein khaali = root par chalta hai.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

export default { basePath };
