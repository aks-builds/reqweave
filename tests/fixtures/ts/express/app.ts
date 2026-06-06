// Fixture: an Express app. Parsed syntactically by the TS analyzer; never run.
import express from "express";

const app = express();
const router = express.Router();

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

router.get("/widgets/:id", (req, res) => {
  const id = req.params.id;
  res.json({ id });
});

router.post("/widgets", (req, res) => {
  const body = req.body;
  const sort = req.query.sort;
  res.status(201).json(body);
});

app.use("/api", router);

export default app;
