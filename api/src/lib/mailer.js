// Mail interface. Default transport logs to stdout (dev). Plug an SMTP transport here later; no paid email API.
import { log } from "./logger.js";

let transport = async ({ to, subject, text }) => {
  log.info("mail (console transport)", { to, subject, preview: text.slice(0, 200) });
  return { delivered: false, transport: "console" };
};

export const setMailTransport = (fn) => { transport = fn; };
export const sendMail = (msg) => transport(msg);
