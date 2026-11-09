import { MongoClient, Binary } from "mongodb";

let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: `Método ${req.method} no permitido` });
  }

  try {
    const client = await connectToDatabase();
    const db = client.db(process.env.MONGODB_DB || "mouses");
    const collection = db.collection(process.env.MONGODB_COLLECTION || "fotos");

    // Nota: Para recibir archivos binarios en Vercel sin dependencias complejas de multer en serverless,
    // asegúrate de procesar el body o usa un storage externo como Cloudinary si experimentas problemas de tamaño.
    
    return res.status(200).json({ ok: true, message: "Conectado correctamente a MongoDB en Vercel" });
  } catch (error) {
    console.error("Error de conexión:", error);
    return res.status(500).json({ ok: false, error: "No se pudo procesar la petición con la base de datos." });
  }
}
