/**
 * Seed.
 *
 *   SEED_MODE=demo (default)  demo agency, six demo users, demo client/engagement.
 *   SEED_MODE=production      one organisation (ORG_NAME) and one administrator
 *                             (ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD). No demo data.
 *
 * Seeds the regulatory *structure* only. No regulatory figure (target,
 * weighting, threshold, recognition level, Gazette number or date) is invented:
 * every such value is left REGULATORY_CONFIGURATION_REQUIRED until a Regulatory
 * Administrator captures it from an uploaded authoritative source and it is
 * approved through the workflow.
 */
import { PrismaClient, type Role, type ScorecardElementCode } from "@prisma/client";
import bcrypt from "bcryptjs";
import { validatePasswordPolicy } from "../src/lib/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/lib/rbac/permissions";

const prisma = new PrismaClient();
const RCR = "REGULATORY_CONFIGURATION_REQUIRED";

const PRODUCTION = process.env.SEED_MODE === "production";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Verify-Dev-2026!";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required when SEED_MODE=production`);
  return v;
}

const USERS: Array<{ email: string; name: string; role: Role }> = [
  { email: "admin@agency.test", name: "Platform Administrator", role: "ADMINISTRATOR" },
  { email: "manager@agency.test", name: "Verification Manager", role: "VERIFICATION_MANAGER" },
  { email: "analyst@agency.test", name: "Verification Analyst", role: "VERIFICATION_ANALYST" },
  { email: "signatory@agency.test", name: "Technical Signatory", role: "TECHNICAL_SIGNATORY" },
  { email: "reviewer@agency.test", name: "Read-only Reviewer", role: "READ_ONLY_REVIEWER" },
  { email: "client@client.test", name: "Client Contact", role: "CLIENT_USER" },
];

const ELEMENTS: Array<{ element: ScorecardElementCode; name: string }> = [
  { element: "OWNERSHIP", name: "Ownership" },
  { element: "MANAGEMENT_CONTROL", name: "Management Control" },
  { element: "SKILLS_DEVELOPMENT", name: "Skills Development" },
  { element: "PREFERENTIAL_PROCUREMENT", name: "Preferential Procurement" },
  { element: "SUPPLIER_DEVELOPMENT", name: "Supplier Development" },
  { element: "ENTERPRISE_DEVELOPMENT", name: "Enterprise Development" },
  { element: "SOCIO_ECONOMIC_DEVELOPMENT", name: "Socio-Economic Development" },
];

/** Sector Code families recognised by the platform. Scope text and versions are captured from gazetted sources. */
const SECTOR_CODES = [
  ["ICT", "Information and Communication Technology Sector Code"],
  ["FSC", "Financial Sector Code"],
  ["CONSTRUCTION", "Construction Sector Code"],
  ["PROPERTY", "Property Sector Code"],
  ["TOURISM", "Tourism Sector Code"],
  ["AGRIBEE", "AgriBEE Sector Code"],
  ["TRANSPORT", "Integrated Transport Sector Code"],
  ["FORESTRY", "Forest Sector Code"],
  ["CA", "Chartered Accountancy Sector Code"],
  ["MAC", "Marketing, Advertising and Communication Sector Code"],
  ["DEFENCE", "Defence Sector Code"],
] as const;

async function main() {
  const orgName = PRODUCTION ? required("ORG_NAME") : "Demo Verification Agency";
  let users: Array<{ email: string; name: string; role: Role }> = USERS;
  let password = SEED_PASSWORD;
  if (PRODUCTION) {
    password = required("ADMIN_PASSWORD");
    const problems = validatePasswordPolicy(password);
    if (problems.length) throw new Error(`ADMIN_PASSWORD: ${problems.join(" ")}`);
    users = [{ email: required("ADMIN_EMAIL").toLowerCase(), name: required("ADMIN_NAME"), role: "ADMINISTRATOR" }];
  }
  const passwordHash = await bcrypt.hash(password, 12);

  const org =
    (await prisma.organisation.findFirst({ where: { name: orgName } })) ??
    (await prisma.organisation.create({ data: { name: orgName } }));

  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const permission of perms) {
      await prisma.rolePermission.upsert({
        where: { organisationId_role_permission: { organisationId: org.id, role: role as Role, permission } },
        update: {},
        create: { organisationId: org.id, role: role as Role, permission },
      });
    }
  }

  const userIds: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, organisationId: org.id, passwordHash },
    });
    userIds[u.role] = user.id;
  }

  // ---- Regulatory library skeleton -----------------------------------------
  for (const [code, name] of SECTOR_CODES) {
    await prisma.sectorCode.upsert({ where: { code }, update: {}, create: { code, name } });
  }

  const generic = await prisma.regulatoryFramework.upsert({
    where: { code: "GENERIC" },
    update: {},
    create: {
      code: "GENERIC",
      name: "Codes of Good Practice — Generic Scorecard",
      description: "Generic Codes. Provisions, targets and weightings are captured from uploaded Gazette sources.",
    },
  });

  const existingDocs = await prisma.regulatoryDocument.count();
  if (existingDocs === 0) {
    await prisma.regulatoryDocument.createMany({
      data: [
        {
          frameworkId: generic.id,
          title: "Broad-Based Black Economic Empowerment Act, 2003 (as amended)",
          source: "AWAITING AUTHORITATIVE SOURCE UPLOAD",
          documentType: "ACT",
          version: "unconfirmed",
          status: "DRAFT",
        },
        {
          frameworkId: generic.id,
          title: "Codes of Good Practice on Broad-Based Black Economic Empowerment (Generic) — current amended version",
          source: "AWAITING AUTHORITATIVE SOURCE UPLOAD",
          documentType: "CODES_OF_GOOD_PRACTICE",
          version: "unconfirmed",
          status: "DRAFT",
        },
      ],
    });
  }

  let version = await prisma.regulatoryVersion.findFirst({ where: { frameworkId: generic.id } });
  if (!version) {
    version = await prisma.regulatoryVersion.create({
      data: {
        frameworkId: generic.id,
        label: "Generic Codes — configuration pending authoritative source",
        status: "DRAFT",
        validFrom: null,
      },
    });
    await prisma.recognitionTable.create({
      data: {
        regulatoryVersionId: version.id,
        bands: { bands: [], nonCompliantLabel: "Non-Compliant", nonCompliantRecognition: "0" },
        discountPolicy: { configurationStatus: RCR, mode: "ONE_LEVEL_IF_ANY_FAIL", levelsPerDiscount: 1 },
        configurationStatus: RCR,
      },
    });
    await prisma.entityClassificationRule.create({
      data: { regulatoryVersionId: version.id, sectorCode: null, thresholds: {}, configurationStatus: RCR },
    });

    for (const classification of ["GENERIC", "QSE"] as const) {
      const template = await prisma.scorecardTemplate.create({
        data: {
          regulatoryVersionId: version.id,
          code: `GENERIC-${classification}`,
          name: `Generic Codes — ${classification === "GENERIC" ? "Large Enterprise" : "QSE"} scorecard`,
          entityClassification: classification,
        },
      });
      for (const [i, el] of ELEMENTS.entries()) {
        const element = await prisma.scorecardElement.create({
          data: {
            templateId: template.id,
            element: el.element,
            name: el.name,
            sortOrder: i,
            configurationStatus: RCR,
          },
        });
        const indicator = await prisma.scorecardIndicator.create({
          data: {
            elementId: element.id,
            code: `${el.element}.UNMAPPED`,
            name: `${el.name} — indicators to be mapped from the gazetted Code`,
            sortOrder: 0,
          },
        });
        await prisma.calculationRule.upsert({
          where: { regulatoryVersionId_indicatorCode: { regulatoryVersionId: version.id, indicatorCode: `${classification}.${el.element}.UNMAPPED` } },
          update: {},
          create: {
            regulatoryVersionId: version.id,
            indicatorId: indicator.id,
            indicatorCode: `${classification}.${el.element}.UNMAPPED`,
            formulaType: "PROPORTIONAL",
            parameters: {},
            configurationStatus: RCR,
            notes: "Awaiting authoritative source. Do not configure from memory.",
          },
        });
      }
    }
  }

  if (PRODUCTION) {
    console.log(`Production seed complete: organisation "${orgName}", administrator ${users[0]!.email}.`);
    return;
  }

  // ---- Demo client & engagement --------------------------------------------
  let client = await prisma.client.findFirst({ where: { organisationId: org.id, name: "Demo Client (Pty) Ltd" } });
  if (!client) {
    client = await prisma.client.create({
      data: { organisationId: org.id, name: "Demo Client (Pty) Ltd", contactName: "Client Contact", contactEmail: "client@client.test" },
    });
    await prisma.clientUserAccess.create({ data: { userId: userIds.CLIENT_USER!, clientId: client.id } });
    const entity = await prisma.measuredEntity.create({
      data: { clientId: client.id, legalName: "Demo Client (Pty) Ltd", industryDescription: "Professional services" },
    });
    await prisma.verificationEngagement.create({
      data: {
        reference: "VER-2026-0001",
        clientId: client.id,
        measuredEntityId: entity.id,
        status: "EVIDENCE_COLLECTION",
        managerId: userIds.VERIFICATION_MANAGER,
        analystId: userIds.VERIFICATION_ANALYST,
        signatoryId: userIds.TECHNICAL_SIGNATORY,
        measurementPeriods: {
          create: {
            label: "FY2026",
            startDate: new Date("2025-03-01"),
            endDate: new Date("2026-02-28"),
            financialYearEnd: new Date("2026-02-28"),
          },
        },
      },
    });
  }

  console.log(`Seed complete. Users (password from SEED_PASSWORD or default "${SEED_PASSWORD}"):`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(22)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
