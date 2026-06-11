// src/ui/main.ts — container/CLI entrypoint for the depot UI. Fails fast on
// missing credentials: an unprotected journal must never start by accident.
import { dataDir } from "../paper/store";
import { createUiServer } from "./server";

const user = process.env.UI_USER ?? "";
const pass = process.env.UI_PASS ?? "";
if (user === "" || pass === "") {
  console.error("[ui] UI_USER and UI_PASS are required — refusing to serve the depot unprotected.");
  process.exit(1);
}

const port = Number(process.env.UI_PORT ?? "8744");
const startBalance = Number(process.env.PAPER_START_BALANCE ?? "2000");

createUiServer({ dir: dataDir(), user, pass, startBalance }).listen(port, () => {
  console.log(`[ui] depot UI listening on :${port} (data: ${dataDir()})`);
});
