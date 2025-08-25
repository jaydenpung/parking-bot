# Parking Duration Tracker Bot

A Telegram bot that tracks parking duration by analyzing screenshots of parking tickets/meters using OCR and AI.

## Features

- 📸 Analyzes parking ticket/meter screenshots using OCR
- 🤖 Intelligent time extraction with Google Gemini AI
- ⏱️ Automatic duration calculation (supports multi-day parking)
- 📊 Monthly parking totals and history tracking
- 👥 Works in both private chats and group chats
- 🔒 Chat-specific data isolation

## Prerequisites

- Node.js (v18 or higher)
- Telegram Bot Token
- Google Gemini API Key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd parking-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
```

## Setting Up Your Telegram Bot

### 1. Create a Bot with BotFather

1. Open Telegram and search for **@BotFather**
2. Start a chat with BotFather
3. Send `/newbot` command
4. Choose a name for your bot (e.g., "Parking Duration Tracker")
5. Choose a username for your bot (must end with `bot`, e.g., `ParkingDurationBot`)
6. BotFather will provide you with a token like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
7. Copy this token to your `.env` file as `TELEGRAM_BOT_TOKEN`

### 2. Configure Bot Settings

#### Set Group Privacy (Important for Group Chats)
```
1. Send /mybots to BotFather
2. Select your bot
3. Click "Bot Settings"
4. Click "Group Privacy"
5. Click "Turn off"
```
**Note:** This allows the bot to see all messages in groups, not just commands.

#### Set Commands Menu
Send this to BotFather after selecting your bot:
```
/setcommands

Then paste:
current - View this month's parking sessions and total
history - See complete parking history by month
reset - Reset current month (requires confirmation)
help - Show help message
```

### 3. Optional Settings

#### Set Description
```
/setdescription
I help track your parking duration by analyzing screenshots of parking tickets/meters.
```

#### Set About Text
```
/setabouttext
Parking Duration Tracker - OCR-powered parking time tracker
```

## Getting Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the API key to your `.env` file as `GEMINI_API_KEY`

## Running the Bot

### Development
```bash
npm start
```

### Production with Docker (Recommended)

#### Using Docker Compose
```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

#### Using Docker directly
```bash
# Build the image
docker build -t parking-bot .

# Run the container
docker run -d \
  --name parking-bot \
  --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e GEMINI_API_KEY=your_api_key \
  -v $(pwd)/data:/usr/src/app/data \
  parking-bot

# View logs
docker logs -f parking-bot

# Stop and remove
docker stop parking-bot
docker rm parking-bot
```

### Production with PM2
```bash
npm install -g pm2
pm2 start src/bot.js --name parking-bot
pm2 save
pm2 startup
```

## Usage

### Commands

- `/current` - View current month's parking sessions and total
- `/history` - See complete parking history organized by month
- `/reset` - Reset current month data (requires confirmation)
- `/help` - Show help message

### How to Use

1. **Send a parking ticket screenshot** to the bot
2. The bot will:
   - Extract text using OCR
   - Parse parking times using AI
   - Calculate duration
   - Save to database
   - Show monthly total

### Supported Formats

The bot can extract times from various formats:
- Standard: "9:00 AM - 5:00 PM"
- Military: "0900 - 1700"
- Text: "From 9:00 to 17:00"
- Multi-day: "23 Aug 2025, 10:35PM - 24 Aug 2025, 1:00AM"

## Database

The bot uses SQLite database (`parking.db`) with two main tables:
- `parking_records` - Individual parking sessions
- `monthly_totals` - Aggregated monthly totals

Data is isolated per chat ID, so different chats maintain separate records.

## Project Structure

```
parking-bot/
├── src/
│   ├── bot.js          # Main bot logic and command handlers
│   ├── database.js     # SQLite database operations
│   ├── ocr.js          # Tesseract OCR processing
│   ├── geminiParser.js # Gemini AI time extraction
│   └── utils.js        # Utility functions
├── data/              # Docker volume for database (created at runtime)
├── downloads/         # Temporary image storage
├── parking.db        # SQLite database
├── .env             # Environment variables
├── .gitignore       # Git ignore file
├── .dockerignore    # Docker ignore file
├── Dockerfile       # Docker container definition
├── docker-compose.yml # Docker Compose configuration
├── package.json     # Node.js dependencies
└── README.md        # This file
```

## Docker Deployment Notes

### Data Persistence
- Database is stored in `./data` directory (created automatically)
- This directory is mounted as a volume to persist data between container restarts
- Backup: Simply copy the `data/parking.db` file

### Environment Variables
- The `.env` file is automatically loaded by docker-compose
- For production, consider using Docker secrets or environment-specific configs

### Resource Usage
- Default limits: 1 CPU, 512MB RAM
- Adjust in `docker-compose.yml` if needed
- Tesseract OCR may need more memory for large images

## Troubleshooting

### Bot not responding in groups
- Ensure Group Privacy is turned OFF in BotFather settings
- Make sure the bot is added as an admin (optional but recommended)

### 409 Conflict Error
- This means multiple instances are running
- Kill all processes: `pkill -f "node.*bot.js"`
- Or if using Docker: `docker-compose down` then `docker-compose up -d`

### OCR not working properly
- Ensure images are clear and well-lit
- Text should be readable
- The bot will show confidence level for each extraction

### Docker Issues
- If database not persisting: Check `./data` directory permissions
- If OCR fails: Tesseract is included in the Docker image
- Memory issues: Increase limits in `docker-compose.yml`

## Security Notes

- Never commit `.env` file to version control
- Keep your bot token and API keys secret
- The bot token in `.gitignore` is already configured
- Database is stored locally and not synced

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)