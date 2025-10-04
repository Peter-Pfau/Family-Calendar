const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const EVENTS_FILE = path.join(__dirname, 'data', 'events.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.ics', '.csv'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext));
    }
});

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.access(path.join(__dirname, 'data'));
    } catch {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    }
}

// Load events from file
async function loadEvents() {
    try {
        const data = await fs.readFile(EVENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist, return empty array
        return [];
    }
}

// Save events to file
async function saveEvents(events) {
    await ensureDataDir();
    await fs.writeFile(EVENTS_FILE, JSON.stringify(events, null, 2));

    // Also save to monthly files
    await saveEventsToMonthlyFiles(events);
}

// Save events to monthly JSON files
async function saveEventsToMonthlyFiles(events) {
    const monthlyEvents = {};

    // Group events by year-month
    events.forEach(event => {
        if (event.date) {
            const date = new Date(event.date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const monthKey = `${year}-${month}`;

            if (!monthlyEvents[monthKey]) {
                monthlyEvents[monthKey] = [];
            }
            monthlyEvents[monthKey].push(event);
        }
    });

    // Save each month's events to separate files
    for (const [monthKey, monthEvents] of Object.entries(monthlyEvents)) {
        const monthFile = path.join(__dirname, 'data', `${monthKey}.json`);
        await fs.writeFile(monthFile, JSON.stringify(monthEvents, null, 2));
    }
}

// Load events from a specific month
async function loadEventsFromMonth(year, month) {
    try {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const monthFile = path.join(__dirname, 'data', `${monthKey}.json`);
        const data = await fs.readFile(monthFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist, return empty array
        return [];
    }
}

// Load all events from monthly files
async function loadAllEventsFromMonthlyFiles() {
    try {
        const dataDir = path.join(__dirname, 'data');
        await ensureDataDir();
        const files = await fs.readdir(dataDir);
        const monthlyFiles = files.filter(file => /^\d{4}-\d{2}\.json$/.test(file));

        let allEvents = [];
        for (const file of monthlyFiles) {
            try {
                const filePath = path.join(dataDir, file);
                const data = await fs.readFile(filePath, 'utf8');
                const monthEvents = JSON.parse(data);
                if (Array.isArray(monthEvents)) {
                    allEvents = allEvents.concat(monthEvents);
                }
            } catch (fileError) {
                console.error(`Error reading file ${file}:`, fileError);
            }
        }

        return allEvents;
    } catch (error) {
        console.error('Error loading monthly files:', error);
        return [];
    }
}

// API Routes

// Get all events
app.get('/api/events', async (req, res) => {
    try {
        const events = await loadEvents();
        res.json(events);
    } catch (error) {
        console.error('Error loading events:', error);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

// Get events for a specific month
app.get('/api/events/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const events = await loadEventsFromMonth(parseInt(year), parseInt(month));
        res.json(events);
    } catch (error) {
        console.error('Error loading monthly events:', error);
        res.status(500).json({ error: 'Failed to load monthly events' });
    }
});

// Load events from monthly files (alternative to main events.json)
app.get('/api/events/monthly/all', async (req, res) => {
    try {
        console.log('Loading all events from monthly files...');
        const events = await loadAllEventsFromMonthlyFiles();
        console.log('Loaded events:', events.length);
        res.json(events);
    } catch (error) {
        console.error('Error loading events from monthly files:', error);
        res.status(500).json({ error: 'Failed to load events from monthly files' });
    }
});

// Add new event
app.post('/api/events', async (req, res) => {
    try {
        const events = await loadEvents();
        const newEvent = {
            id: 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        events.push(newEvent);
        await saveEvents(events);
        res.status(201).json(newEvent);
    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).json({ error: 'Failed to add event' });
    }
});

// Update event
app.put('/api/events/:id', async (req, res) => {
    try {
        const events = await loadEvents();
        const eventIndex = events.findIndex(e => e.id === req.params.id);
        
        if (eventIndex === -1) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        events[eventIndex] = {
            ...events[eventIndex],
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await saveEvents(events);
        res.json(events[eventIndex]);
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// Delete event
app.delete('/api/events/:id', async (req, res) => {
    try {
        const events = await loadEvents();
        const eventIndex = events.findIndex(e => e.id === req.params.id);
        
        if (eventIndex === -1) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        const deletedEvent = events.splice(eventIndex, 1)[0];
        await saveEvents(events);
        res.json(deletedEvent);
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// Upload and parse calendar file
app.post('/api/import', upload.single('calendarFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const filePath = req.file.path;
        const fileContent = await fs.readFile(filePath, 'utf8');
        const events = await loadEvents();
        
        let importedEvents = [];
        
        if (req.file.originalname.endsWith('.ics')) {
            importedEvents = parseICSFile(fileContent);
        } else if (req.file.originalname.endsWith('.csv')) {
            importedEvents = parseCSVFile(fileContent);
        }
        
        // Add imported events to existing events
        events.push(...importedEvents);
        await saveEvents(events);
        
        // Clean up uploaded file
        await fs.unlink(filePath);
        
        res.json({ 
            message: `Imported ${importedEvents.length} events successfully`,
            importedCount: importedEvents.length 
        });
    } catch (error) {
        console.error('Error importing events:', error);
        res.status(500).json({ error: 'Failed to import events' });
    }
});

// Helper functions for parsing files
function parseICSFile(content) {
    const events = [];
    const lines = content.split('\n');
    let currentEvent = null;
    
    for (let line of lines) {
        line = line.trim();
        
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (line === 'END:VEVENT' && currentEvent) {
            if (currentEvent.title && currentEvent.date) {
                const detectedEmoji = detectEmojiFromTitle(currentEvent.title);
                events.push({
                    id: 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                    title: currentEvent.title,
                    date: currentEvent.date,
                    time: currentEvent.time || '',
                    description: currentEvent.description || '',
                    color: 'blue',
                    emoji: detectedEmoji,
                    createdAt: new Date().toISOString()
                });
            }
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith('SUMMARY:')) {
                currentEvent.title = line.substring(8);
            } else if (line.startsWith('DTSTART')) {
                const dateMatch = line.match(/(\d{8})/);
                if (dateMatch) {
                    const dateStr = dateMatch[1];
                    const year = dateStr.substring(0, 4);
                    const month = dateStr.substring(4, 6);
                    const day = dateStr.substring(6, 8);
                    currentEvent.date = `${year}-${month}-${day}`;
                }
                
                const timeMatch = line.match(/T(\d{6})/);
                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    const hour = timeStr.substring(0, 2);
                    const minute = timeStr.substring(2, 4);
                    currentEvent.time = `${hour}:${minute}`;
                }
            } else if (line.startsWith('DESCRIPTION:')) {
                currentEvent.description = line.substring(12);
            }
        }
    }
    
    return events;
}

function parseCSVFile(content) {
    const lines = content.split('\n');
    const events = [];
    
    const startIndex = lines[0].toLowerCase().includes('title') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = parseCSVLine(line);
        if (columns.length >= 2) {
            const title = columns[0];
            const date = parseDate(columns[1]);
            const time = columns.length > 2 ? columns[2] : '';
            const description = columns.length > 3 ? columns[3] : '';
            
            if (title && date) {
                const detectedEmoji = detectEmojiFromTitle(title);
                events.push({
                    id: 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                    title: title,
                    date: date,
                    time: time,
                    description: description,
                    color: 'blue',
                    emoji: detectedEmoji,
                    createdAt: new Date().toISOString()
                });
            }
        }
    }
    
    return events;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result.map(field => field.replace(/^"(.*)"$/, '$1'));
}

function parseDate(dateString) {
    const formats = [
        /^(\d{4})-(\d{2})-(\d{2})$/,
        /^(\d{2})\/(\d{2})\/(\d{4})$/,
        /^(\d{2})\/(\d{2})\/(\d{2})$/,
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    ];
    
    for (let format of formats) {
        const match = dateString.match(format);
        if (match) {
            let year, month, day;
            
            if (format.source.startsWith('^(\\d{4})')) {
                year = match[1];
                month = match[2];
                day = match[3];
            } else {
                month = match[1].padStart(2, '0');
                day = match[2].padStart(2, '0');
                year = match[3];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
            }
            
            return `${year}-${month}-${day}`;
        }
    }
    
    return null;
}

function detectEmojiFromTitle(title) {
    if (!title) return '';
    
    const titleLower = title.toLowerCase();
    
    // Sports emojis
    if (titleLower.includes('football')) return '🏈';
    if (titleLower.includes('basketball')) return '🏀';
    if (titleLower.includes('soccer')) return '⚽';
    
    // Celebration emojis
    if (titleLower.includes('birthday')) return '🎂';
    if (titleLower.includes('party')) return '🎉';
    if (titleLower.includes('celebration')) return '🥳';
    if (titleLower.includes('anniversary')) return '❤️';
    
    // Work/School emojis
    if (titleLower.includes('meeting')) return '💼';
    if (titleLower.includes('work')) return '💻';
    if (titleLower.includes('school')) return '📚';
    if (titleLower.includes('class')) return '📖';
    if (titleLower.includes('exam') || titleLower.includes('test')) return '✏️';
    if (titleLower.includes('presentation')) return '📊';
    if (titleLower.includes('graduation')) return '🎓';
    
    // Health/Medical emojis
    if (titleLower.includes('doctor') || titleLower.includes('appointment')) return '🏥';
    if (titleLower.includes('dentist')) return '🏥';
    if (titleLower.includes('medicine') || titleLower.includes('pill')) return '💊';
    if (titleLower.includes('workout') || titleLower.includes('gym')) return '🏋️';
    if (titleLower.includes('yoga') || titleLower.includes('meditation')) return '🧘';
    
    // Food/Dining emojis
    if (titleLower.includes('lunch') || titleLower.includes('dinner') || titleLower.includes('breakfast')) return '🍕';
    if (titleLower.includes('coffee')) return '☕';
    if (titleLower.includes('cake') || titleLower.includes('dessert')) return '🍰';
    
    // Travel emojis
    if (titleLower.includes('flight') || titleLower.includes('airplane')) return '✈️';
    if (titleLower.includes('drive') || titleLower.includes('car')) return '🚗';
    if (titleLower.includes('vacation') || titleLower.includes('holiday')) return '🏖️';
    if (titleLower.includes('trip') || titleLower.includes('travel')) return '🗺️';
    if (titleLower.includes('beach')) return '⛱️';
    
    // Entertainment emojis
    if (titleLower.includes('music') || titleLower.includes('concert')) return '🎵';
    if (titleLower.includes('movie') || titleLower.includes('film')) return '🎪';
    if (titleLower.includes('game') || titleLower.includes('gaming')) return '🎮';
    if (titleLower.includes('art') || titleLower.includes('paint')) return '🎨';
    if (titleLower.includes('reading') || titleLower.includes('book')) return '📚';
    
    // Activity emojis
    if (titleLower.includes('run') || titleLower.includes('running')) return '🏃';
    if (titleLower.includes('walk') || titleLower.includes('walking')) return '🏃';
    
    // Default - no emoji
    return '';
}

// Serve the main HTML file for any non-API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Family Calendar server running on http://localhost:${PORT}`);
    console.log(`
🎉 Server Features:
   • REST API for events (/api/events)
   • File upload for calendar imports (/api/import)
   • Persistent JSON file storage
   • CORS enabled for development
   
📂 API Endpoints:
   GET    /api/events        - Get all events
   POST   /api/events        - Create new event
   PUT    /api/events/:id    - Update event
   DELETE /api/events/:id    - Delete event
   POST   /api/import        - Import calendar file
`);
});