import { mutateDb, getDataFilePath } from "./store.js";

const createdAt = new Date().toISOString();

const seedData = {
  employees: [
    {
      id: "0000001",
      name: "Aman Sharma",
      department: "Sales",
      pin: "1111",
      active: true,
      createdAt
    },
    {
      id: "0000002",
      name: "Neha Verma",
      department: "Operations",
      pin: "2222",
      active: true,
      createdAt
    },
    {
      id: "0000003",
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
  await mutateDb((db) => {
    db.employees = [...seedData.employees];
    db.attendance = [];
    db.punchEvents = [];
    db.settings = { ...seedData.settings };
  });

  console.log(`Seed data applied successfully (${getDataFilePath()})`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
