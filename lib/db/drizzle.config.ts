import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDatabaseUrl } from "./src/config";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = validateDatabaseUrl(process.env["DATABASE_URL"]);

export default defineConfig({
  schema: path.join(configDirectory, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
