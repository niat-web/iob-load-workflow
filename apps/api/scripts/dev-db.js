import { MongoMemoryServer } from "mongodb-memory-server";

const port = Number(process.env.DEV_DB_PORT ?? 27017);
const server = await MongoMemoryServer.create({ instance: { port, dbName: "job_flow", ip: "127.0.0.1" } });
console.log(`In-memory MongoDB ready at ${server.getUri()}job_flow  (Ctrl+C to stop)`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
