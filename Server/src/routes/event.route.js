import { Router } from "express";
import {newFarmData,newNGORequest,newShipment} from "../controllers/events.controller.js";
//import controllers

const router=Router();

router.post("/farm", newFarmData);
router.post("/request", newNGORequest);
router.post("/shipment", newShipment);


export default router;