import { promises as fs } from "node:fs";
import path from "node:path";

const createdAt = new Date().toISOString();

const seedData = {
  employees: [
    {
      id: "EMP001",
      name: "Aman Sharma",
      department: "Sales",
      pin: "1111",
      active: true,
      createdAt
    },
    {
      id: "EMP002",
      name: "Neha Verma",
      department: "Operations",
      pin: "2222",
      active: true,
      createdAt
    },
    {
      id: "EMP003",
      name: "Rahul Singh",
      department: "Finance",
      pin: "3333",
      active: true,
      createdAt
    }
  ],
  attendance: [],
  punchEvents: [],
  settings: {
    shiftStart: "09:30",
    shiftEnd: "18:30",
    graceMinutes: 10,
    autoPunchOut: true,
    autoPunchOutTime: "19:00",
    workingDays: [1, 2, 3, 4, 5, 6]
  }
};

async function run() {
  const filePath = path.resolve(process.cwd(), "data", "store.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(seedData, null, 2), "utf8");
  console.log(`Seed data written to ${filePath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
