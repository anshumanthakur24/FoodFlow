import { Router } from "express";
import {createRequest,updateRequestStatus,getRequestsByNGO} from "../controllers/ngo.controller.js";


const router=Router();

router.post("/createRequest", createRequest);
router.patch("/:requestID/status", updateRequestStatus);
router.get("/getAllRequets/:ngoId",getRequestsByNGO);



export default router;