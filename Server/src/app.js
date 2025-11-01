import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import logger from "./middleware/logger.middleware.js";


const app = express();
app.use(cookieParser());
 


app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"))

// Logger middleware - should be after body parsers but before routes
app.use(logger);

// Routes Import
import eventRouter from "./routes/event.route.js";
import mapRouter from "./routes/map.routes.js";
import nodeRouter from "./routes/node.route.js"

// Routes Declaration
app.use("/api/v1/event/",eventRouter);  //for recieving the data from the dummy server
app.use("/api/v1/map",mapRouter);
app.use("/api/v1/node",nodeRouter);

export { app };
