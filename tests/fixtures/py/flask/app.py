# Fixture: a Flask app. Read syntactically by reqweave; never imported or run.
from flask import Flask, request, jsonify

app = Flask(__name__)


@app.route("/widgets/<int:widget_id>", methods=["GET"])
def get_widget(widget_id: int):
    return jsonify({"id": widget_id})


@app.route("/widgets", methods=["GET", "POST"])
def widgets():
    if request.method == "POST":
        data = request.json
        return jsonify(data), 201
    sort = request.args.get("sort")
    return jsonify([])


@app.get("/health")
def health():
    return {"ok": True}
