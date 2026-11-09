const path = require("node:path");

const express = require("express");
const multer = require("multer");
const { Binary, MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "mouses";
const mongoCollectionName = process.env.MONGODB_COLLECTION || "fotos";
const host = process.env.HOST || "127.0.0.1";
const adminEnabled = process.env.ENABLE_ADMIN === "true";

const app = express();
const mongoClient = mongoUri
  ? new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 })
  : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new Error("El formato de imagen no está permitido."));
      return;
    }
    callback(null, true);
  }
});

let photosCollection;
let mongoConnectionError = null;

function safeFilename(filename) {
  const basename = path.basename(filename || "imagen");
  return basename.replace(/[^\w.-]+/g, "_").slice(0, 160) || "imagen";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

app.use(express.json({ limit: "32kb" }));

app.get("/", (_request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (_request, response) => {
  if (!adminEnabled) {
    response.status(404).end();
    return;
  }
  response.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (_request, response) => {
  if (!adminEnabled) {
    response.status(404).end();
    return;
  }
  response.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/admin/photos", async (_request, response) => {
  if (!adminEnabled) {
    response.status(404).end();
    return;
  }

  if (!photosCollection) {
    response.status(503).json({
      ok: false,
      error: "El servicio todavía no está listo."
    });
    return;
  }

  try {
    const documents = await photosCollection
      .find({}, {
        projection: {
          imagen: 0
        }
      })
      .sort({ creado: -1 })
      .toArray();

    response.json({
      ok: true,
      fotos: documents.map((document) => ({
        id: document._id.toString(),
        nombre: document.nombre || "imagen",
        tipo: document.tipo || "image/jpeg",
        tamano: document.tamano || 0,
        ancho: document.ancho || null,
        alto: document.alto || null,
        brillo: document.brillo ?? null,
        creado: document.creado instanceof Date
          ? document.creado.toISOString()
          : document.creado || null
      }))
    });
  } catch (error) {
    console.error("No se pudieron cargar las imágenes:", error);
    response.status(500).json({
      ok: false,
      error: "No se pudieron cargar las imágenes."
    });
  }
});

app.get("/api/admin/photos/:id/image", async (request, response) => {
  if (!adminEnabled) {
    response.status(404).end();
    return;
  }

  if (!photosCollection || !ObjectId.isValid(request.params.id)) {
    response.status(404).end();
    return;
  }

  try {
    const document = await photosCollection.findOne(
      { _id: new ObjectId(request.params.id) },
      { projection: { imagen: 1, tipo: 1, nombre: 1 } }
    );

    if (!document?.imagen) {
      response.status(404).end();
      return;
    }

    const buffer = Buffer.isBuffer(document.imagen)
      ? document.imagen
      : document.imagen.buffer;

    response.setHeader("Content-Type", document.tipo || "application/octet-stream");
    response.setHeader("Cache-Control", "private, no-store");
    if (request.query.download === "1") {
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(document.nombre || "imagen")}"`
      );
    }
    response.send(buffer);
  } catch (error) {
    console.error("No se pudo cargar la imagen:", error);
    response.status(500).end();
  }
});

app.get("/api/health", async (_request, response) => {
  if (!photosCollection || !mongoClient) {
    response.status(503).json({
      ok: false,
      error: mongoConnectionError
        ? "El servicio de almacenamiento no está disponible."
        : "El servicio todavía no está listo."
    });
    return;
  }

  try {
    await mongoClient.db(mongoDbName).command({ ping: 1 });
    response.json({ ok: true, database: mongoDbName });
  } catch (_error) {
    response.status(503).json({ ok: false, error: "El servicio de almacenamiento no está disponible." });
  }
});

app.post("/api/upload", upload.single("foto"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ ok: false, error: "No llegó ninguna imagen." });
    return;
  }

  if (!photosCollection) {
    response.status(503).json({
      ok: false,
      error: "El servicio todavía no está listo. Inténtalo de nuevo."
    });
    return;
  }

  try {
    const document = {
      nombre: safeFilename(request.file.originalname),
      tipo: request.file.mimetype,
      tamano: request.file.size,
      ancho: numberOrNull(request.body.ancho),
      alto: numberOrNull(request.body.alto),
      brillo: numberOrNull(request.body.brillo),
      imagen: new Binary(request.file.buffer),
      creado: new Date()
    };

    const result = await photosCollection.insertOne(document);

    response.json({
      ok: true,
      id: result.insertedId.toString(),
      nombre: document.nombre,
      tamano: document.tamano
    });
  } catch (error) {
    console.error("Error al guardar la imagen:", error);
    response.status(500).json({
      ok: false,
      error: "No se pudo guardar la imagen."
    });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({
      ok: false,
      error: "La imagen supera el límite de 10 MB."
    });
    return;
  }

  if (error?.message === "El formato de imagen no está permitido.") {
    response.status(400).json({ ok: false, error: error.message });
    return;
  }

  console.error("Error inesperado:", error);
  response.status(500).json({
    ok: false,
    error: "Ocurrió un error inesperado en el servidor."
  });
});

async function connectMongo() {
  if (!mongoClient) {
    mongoConnectionError = new Error("Falta MONGODB_URI en .env.");
    console.error("Falta MONGODB_URI. Completa el archivo .env.");
    return;
  }

  try {
    await mongoClient.connect();
    const database = mongoClient.db(mongoDbName);
    await database.command({ ping: 1 });
    photosCollection = database.collection(mongoCollectionName);
    mongoConnectionError = null;
    console.log(`MongoDB conectado: ${mongoDbName}.${mongoCollectionName}`);
  } catch (error) {
    mongoConnectionError = error;
    if (/bad auth|authentication failed/i.test(error.message)) {
      console.error("MongoDB rechazó las credenciales del usuario de base de datos.");
    } else {
      console.error("No se pudo conectar con MongoDB:", error.message);
    }
  }
}

async function start() {
  app.listen(PORT, host, () => {
    console.log(`MouseMarca disponible en http://${host}:${PORT}`);
  });

  await connectMongo();
}

async function shutdown() {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

start().catch((error) => {
  console.error("No se pudo iniciar MouseMarca:", error.message);
  process.exit(1);
});
