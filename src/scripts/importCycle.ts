import { readFile } from "node:fs/promises";
import { prisma } from "../db/client.js";
import { getEmailSender } from "../lib/email/index.js";
import { importCycle } from "../services/importCycle.js";

function parseArgs(argv: string[]): { file: string; year: number; uploadedBy: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }

  if (!args.file) throw new Error("Missing required --file <path-to-csv>");
  if (!args.year) throw new Error("Missing required --year <cycle-year>");
  if (!args["uploaded-by"]) throw new Error("Missing required --uploaded-by <name-or-email>");

  const year = Number.parseInt(args.year, 10);
  if (!Number.isInteger(year)) throw new Error(`--year must be an integer, got "${args.year}"`);

  return { file: args.file, year, uploadedBy: args["uploaded-by"] };
}

async function main() {
  const { file, year, uploadedBy } = parseArgs(process.argv.slice(2));
  const csvContent = await readFile(file, "utf-8");
  const emailSender = getEmailSender();

  const result = await importCycle(prisma, emailSender, {
    csvContent,
    cycleYear: year,
    uploadedBy,
  });

  console.log(`\nCycle ${year} import from ${file}`);
  console.log(`  Employees in file:        ${result.employeesSeen}`);
  console.log(`  New records created:      ${result.recordsCreated}`);
  console.log(`  Skipped (already exist):  ${result.recordsSkippedExisting}`);
  console.log(`  Emails sent:              ${result.emailsSent}`);

  if (result.rowErrors.length > 0) {
    console.log(`\nRow errors (${result.rowErrors.length}):`);
    for (const rowError of result.rowErrors) {
      console.log(`  line ${rowError.line}: ${rowError.message}`);
    }
  }

  if (result.emailFailures.length > 0) {
    console.log(`\nEmail failures (${result.emailFailures.length}) — records were created but sentAt is unset:`);
    for (const failure of result.emailFailures) {
      console.log(`  ${failure.email}: ${failure.error}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
