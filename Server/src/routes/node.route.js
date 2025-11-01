import express from "express";
import {
  getNodesByRegion,
  createNode,
  deleteNode,
  getAllNodes,
} from "../controllers/node.controller.js";

const router = express.Router();

router.get("/getAllNodes", getAllNodes); //GET /api/nodes/getAllNodes?page=1&limit=10
router.get("/district/:district", getNodesByRegion); //GET /api/nodes/district/:district?page=1&limit=10

router.post("/addNewNode", createNode);
router.delete("/deleteNode/:id", deleteNode);

export default router;
