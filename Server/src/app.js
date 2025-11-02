import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import logger from "./middleware/logger.middleware.js";

const app = express();
app.use(cookieParser());

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static("public"));
import { startScenario } from "./controllers/node.controller.js";

// Logger middleware - should be after body parsers but before routes
app.use(logger);

app.use("/api/v1/startMock", startScenario);
// Routes Import
import eventRouter from "./routes/event.route.js";
import mapRouter from "./routes/map.routes.js";
import nodeRouter from "./routes/node.route.js";
import requestRouter from "./routes/ngo.route.js";
import ngoRouter from "./routes/ngo.route.js";
import mlRouter from "./routes/model.route.js";

// Routes Declaration
app.use("/api/v1/event/", eventRouter); //for recieving the data from the dummy server
app.use("/api/v1/map", mapRouter);
app.use("/api/v1/node", nodeRouter);
app.use("/api/v1/request", requestRouter);
app.use("/api/v1/ngo", ngoRouter);
app.use("/api/ml", mlRouter);

export { app };
