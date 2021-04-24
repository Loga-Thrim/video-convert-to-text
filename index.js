const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const fileUpload = require("express-fileupload");
const uniqueStringGen = require("unique-string-generator");
const app = express();
const path = require("path");
const speech = require('@google-cloud/speech');
const port = process.env.PORT || 5001;
const mongoClient = require("mongodb").MongoClient;
const ObjectId = require('mongodb').ObjectId; 
const mongoUrl = process.env.MONGO_URL || "mongodb://localhost:27017";
const ffmpegPath = process.env.FFMPEG_PATH || __dirname + "/ffmpeg/bin/ffmpeg.exe";

ffmpeg.setFfmpegPath(ffmpegPath);

const { Storage } = require("@google-cloud/storage");
const gc = new Storage({
  keyFilename: path.join(__dirname + "<path and your key filename .json>"),
  projectId: '<Your project id>'
})
const filesBucket = gc.bucket('<Your backet name>');

async function toText(path){
  return new Promise(async (resolve, reject)=>{
    try{
      /* const file = fs.readFileSync(path);
      const audioBytes = file.toString('base64'); */
      const client = new speech.SpeechClient();

      const audio = {
        /* content: audioBytes, */
        uri: path
      };
      const config = {
        encoding: 'MP3',
        sampleRateHertz: 8000,
        enable_automatic_punctuation: true,
        enable_word_time_offsets: true,
        languageCode: 'th-TH',
      };
      const request = {
        audio: audio,
        config: config,
      };
      
      const [operation] = await client.longRunningRecognize(request);
      const [response] = await operation.promise();
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      resolve(transcription)
    } catch(e){
      console.log("Error "+ e);
    }
  })
}

app
    .set("views", './views')
    .set("views", path.join(__dirname, 'views'))
    .set('view engine', 'ejs')
    .use(fileUpload({
        useTempFiles: true,
        tempFileDir: "/video/"
    }))
    .get("/", (req, res)=>{
        res.render("index")
    })
    .get("/history", (req, res)=>{
      mongoClient.connect(mongoUrl, (err, db)=>{
        if(err) throw err;
        const dbcon = db.db("videototext");
        dbcon.collection("generated").find({}).toArray((err, result)=>{
          let arr = [];
          result.forEach((item, index)=>{
            arr.push({
              id: item._id,
              name: item.name,
              time: item.time
            });
            if(index == result.length-1) res.render("history", {data: arr})
          })
        })
      })
    })
    .get("/history/:id", (req, res)=>{
      mongoClient.connect(mongoUrl, {useUnifiedTopology: true},(err, db)=>{
        if(err) throw err;
        const dbcon = db.db("videototext");
        dbcon.collection("generated").findOne({_id: new ObjectId(req.params.id)}, (err, doc)=>{
          if(err) throw err;
          res.render("transcript", {transcript: doc.transcript});
        })
      })
    })
    .post("/convert", (req, res)=>{
      const { videoName } = req.body;
      const uniqueString = uniqueStringGen.UniqueString();
      req.files.mp4.mv("video/" + req.files.mp4.name, err=>{
        if(err) throw err;
        ffmpeg("video/" + req.files.mp4.name).withOutputFormat("mp3")
        .saveToFile(__dirname + "/audio/" + uniqueString + ".mp3")
        .on("end", ()=>{
          filesBucket.upload(__dirname + "/audio/" + uniqueString + ".mp3", (err, file)=>{
            if(err) throw err;
            const videoPath = `gs://mp4speechtotext/${file.name}`;
            toText(videoPath).then(transcript=>{
              mongoClient.connect(mongoUrl, { useUnifiedTopology: true },(err, db)=>{
                if(err) throw err;
                const dbcon = db.db("videototext");
                const time = new Date().toUTCString();
                const insertObj = {
                  name: videoName,
                  file: videoPath,
                  time,
                  transcript
                }
                dbcon.collection("generated").insert(insertObj, (err, docs)=>{
                  if(err) throw err;
                  console.log("inserted docs");
                  res.render("transcript", {transcript})
                })
              })
            })
          })
          
        })
      })
    })
    .get("/verifyauth", (req, res)=>{
      const storage = new Storage();
      async function listBuckets() {
        try {
          const results = await storage.getBuckets();

          const [buckets] = results;

          console.log('Buckets:');
          buckets.forEach(bucket => {
            console.log(bucket.name);
          });
        } catch (err) {
          console.error('ERROR:', err);
        }
      }
      listBuckets();
    })
    .listen(port, ()=>console.log(`> App on port ${port}.`));
