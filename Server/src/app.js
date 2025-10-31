import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";


const app = express();
app.use(cookieParser());
 


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"))

// Routes Import
import {eventRouter} from "./routes/event.route.js";
import {mapRouter} from "./routes/map.routes.js";

// Routes Declaration
app.use("api/v1/event/",eventRouter);  //for recieving the data from the dummy server
app.use("/api/v1/map",mapRouter)

export { app };
