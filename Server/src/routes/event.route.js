import { Router } from "express";
import {storeEvent,newNGORequest,newShipment} from "../controllers/events.controller.js";
//import controllers

const router=Router();

router.post("/farm", storeEvent);
router.post("/request", newNGORequest);
router.post("/shipment", newShipment);


export default router;