# Plant Check web app

Plant Check is a small web app for taking or choosing one plant photo and getting a short, plain-language check.

## Start it on Windows

1. Install Node.js 18 or newer.
2. Copy `.env.example` to a new file named `.env`.
3. Open `.env` and put your Gemini key after `GEMINI_API_KEY=`.
4. Open a terminal in this folder and run `npm start`.
5. Open `http://127.0.0.1:3000` in a browser.

The key stays on the local server. It is never sent to the browser page or saved in the report. Do not put the key in `public/app.js` or commit `.env` to a public repository.

The camera works on `localhost` after the browser allows camera access. You can also choose a JPG, PNG, or WebP photo.

## Lovable or hosted setup

The front end calls `/api/analyze`. For a hosted project, run that handler as a server-side function and save `GEMINI_API_KEY` as a private server secret. Keep the key out of browser code. Do not turn treatment suggestions into automatic medicine release commands.

The report gives possible signs and options for a local crop helper to review. It does not tell a drone or machine to apply medicine.
