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


// Routes Declaration

export { app };
