class FamilyCalendar {
    constructor() {
        this.currentDate = new Date();
        this.events = this.loadEvents();
        this.currentEditingEvent = null;
        
        this.initializeEventListeners();
        this.renderCalendar();
    }

    initializeEventListeners() {
        // Navigation buttons
        document.getElementById('prev-month').addEventListener('click', () => this.navigateMonth(-1));
        document.getElementById('next-month').addEventListener('click', () => this.navigateMonth(1));
        document.getElementById('today-btn').addEventListener('click', () => this.goToToday());
        
        // Add event button
        document.getElementById('add-event-btn').addEventListener('click', () => this.showAddEventModal());
        
        // Import button
        document.getElementById('import-btn').addEventListener('click', () => this.showImportModal());
        
        // Modal close buttons
        document.getElementById('close-modal').addEventListener('click', () => this.hideModal('event-modal'));
        document.getElementById('close-import-modal').addEventListener('click', () => this.hideModal('import-modal'));
        document.getElementById('close-details-modal').addEventListener('click', () => this.hideModal('event-details-modal'));
        document.getElementById('close-schedules-modal').addEventListener('click', () => this.hideModal('schedules-modal'));
        
        // Form buttons
        document.getElementById('cancel-btn').addEventListener('click', () => this.hideModal('event-modal'));
        document.getElementById('close-details-btn').addEventListener('click', () => this.hideModal('event-details-modal'));
        document.getElementById('close-schedules-btn').addEventListener('click', () => this.hideModal('schedules-modal'));
        document.getElementById('delete-event-btn').addEventListener('click', () => this.deleteCurrentEvent());
        document.getElementById('edit-event-btn').addEventListener('click', () => this.editEventFromDetails());
        
        // Event form submission
        document.getElementById('event-form').addEventListener('submit', (e) => this.handleEventSubmit(e));
        
        // File upload
        document.getElementById('upload-btn').addEventListener('click', () => this.handleFileUpload());
        
        // Emoji picker functionality - use setTimeout to ensure DOM is ready
        setTimeout(() => {
            this.initEmojiPicker();
        }, 100);
        
        // Kebab menu functionality
        this.initKebabMenu();
        
        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideModal(e.target.id);
            }
        });
    }

    navigateMonth(direction) {
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        this.renderCalendar();
    }

    goToToday() {
        this.currentDate = new Date();
        this.renderCalendar();
    }

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // Update month/year display
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        document.getElementById('current-month-year').textContent = `${monthNames[month]} ${year}`;
        
        // Get first day of month and number of days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        const calendarGrid = document.getElementById('calendar-grid');
        
        // Remove existing day cells
        const existingCells = calendarGrid.querySelectorAll('.day-cell');
        existingCells.forEach(cell => cell.remove());
        
        // Generate calendar days
        const today = new Date();
        for (let i = 0; i < 42; i++) {
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + i);
            
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell';
            
            // Add classes for styling
            if (cellDate.getMonth() !== month) {
                dayCell.classList.add('other-month');
            }
            
            if (this.isSameDay(cellDate, today)) {
                dayCell.classList.add('today');
            }
            
            // Day number
            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';
            dayNumber.textContent = cellDate.getDate();
            dayCell.appendChild(dayNumber);
            
            // Add events for this day
            const dayEvents = this.getEventsForDay(cellDate);
            dayEvents.forEach(event => {
                const eventElement = document.createElement('div');
                eventElement.className = `event ${event.color}`;
                
                // Add emoji if it exists
                const eventText = event.emoji ? `${event.emoji} ${event.title}` : event.title;
                eventElement.textContent = eventText;
                
                eventElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showEventDetails(event);
                });
                dayCell.appendChild(eventElement);
            });
            
            // Add click handler for day cell
            dayCell.addEventListener('click', () => this.handleDayClick(cellDate));
            
            calendarGrid.appendChild(dayCell);
        }
    }

    handleDayClick(date) {
        this.showAddEventModal(date);
    }

    showAddEventModal(date = null) {
        const modal = document.getElementById('event-modal');
        const form = document.getElementById('event-form');
        const titleElement = document.getElementById('modal-title');
        const deleteBtn = document.getElementById('delete-event-btn');
        
        // Reset form
        form.reset();
        this.currentEditingEvent = null;
        titleElement.textContent = 'Add Event';
        deleteBtn.style.display = 'none';
        
        // Reset emoji picker
        document.getElementById('event-emoji').value = '';
        document.getElementById('emoji-picker-btn').textContent = '😊';
        
        // Set date if provided
        if (date) {
            document.getElementById('event-date').value = this.formatDateForInput(date);
        }
        
        modal.style.display = 'block';
    }

    showEventDetails(event) {
        const modal = document.getElementById('event-details-modal');
        const content = document.getElementById('event-details-content');
        
        const titleWithEmoji = event.emoji ? `${event.emoji} ${event.title}` : event.title;
        
        content.innerHTML = `
            <div class="detail-item">
                <div class="detail-label">Title:</div>
                <div class="detail-value">${titleWithEmoji}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Date:</div>
                <div class="detail-value">${this.formatDateForDisplay(new Date(event.date))}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Time:</div>
                <div class="detail-value">${event.time || 'All day'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Description:</div>
                <div class="detail-value">${event.description || 'No description'}</div>
            </div>
        `;
        
        this.currentEditingEvent = event;
        modal.style.display = 'block';
    }

    editEventFromDetails() {
        this.hideModal('event-details-modal');
        
        const modal = document.getElementById('event-modal');
        const titleElement = document.getElementById('modal-title');
        const deleteBtn = document.getElementById('delete-event-btn');
        
        titleElement.textContent = 'Edit Event';
        deleteBtn.style.display = 'inline-block';
        
        // Populate form with event data
        document.getElementById('event-title').value = this.currentEditingEvent.title;
        document.getElementById('event-date').value = this.currentEditingEvent.date;
        document.getElementById('event-time').value = this.currentEditingEvent.time || '';
        document.getElementById('event-description').value = this.currentEditingEvent.description || '';
        document.getElementById('event-color').value = this.currentEditingEvent.color;
        document.getElementById('event-emoji').value = this.currentEditingEvent.emoji || '';
        
        // Update emoji button display
        const emojiBtn = document.getElementById('emoji-picker-btn');
        emojiBtn.textContent = this.currentEditingEvent.emoji || '😊';
        
        modal.style.display = 'block';
    }

    showImportModal() {
        const modal = document.getElementById('import-modal');
        modal.style.display = 'block';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    handleEventSubmit(e) {
        e.preventDefault();
        
        const title = document.getElementById('event-title').value;
        const date = document.getElementById('event-date').value;
        const time = document.getElementById('event-time').value;
        const description = document.getElementById('event-description').value;
        const color = document.getElementById('event-color').value;
        const emoji = document.getElementById('event-emoji').value;
        
        const event = {
            id: this.currentEditingEvent ? this.currentEditingEvent.id : this.generateId(),
            title,
            date,
            time,
            description,
            color,
            emoji
        };
        
        if (this.currentEditingEvent) {
            // Update existing event
            const index = this.events.findIndex(e => e.id === this.currentEditingEvent.id);
            this.events[index] = event;
        } else {
            // Add new event
            this.events.push(event);
        }
        
        this.saveEvents();
        this.renderCalendar();
        this.hideModal('event-modal');
    }

    deleteCurrentEvent() {
        if (this.currentEditingEvent) {
            const index = this.events.findIndex(e => e.id === this.currentEditingEvent.id);
            if (index > -1) {
                this.events.splice(index, 1);
                this.saveEvents();
                this.renderCalendar();
            }
        }
        this.hideModal('event-modal');
    }

    handleFileUpload() {
        const fileInput = document.getElementById('file-input');
        const file = fileInput.files[0];
        
        if (!file) {
            alert('Please select a file to upload.');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            
            if (file.name.endsWith('.ics')) {
                this.parseICSFile(content);
            } else if (file.name.endsWith('.csv')) {
                this.parseCSVFile(content);
            } else {
                alert('Unsupported file format. Please upload an ICS or CSV file.');
            }
        };
        
        reader.readAsText(file);
    }

    parseICSFile(content) {
        const events = [];
        const lines = content.split('\n');
        let currentEvent = null;
        
        for (let line of lines) {
            line = line.trim();
            
            if (line === 'BEGIN:VEVENT') {
                currentEvent = {};
            } else if (line === 'END:VEVENT' && currentEvent) {
                if (currentEvent.title && currentEvent.date) {
                    const detectedEmoji = this.detectEmojiFromTitle(currentEvent.title);
                    events.push({
                        id: this.generateId(),
                        title: currentEvent.title,
                        date: currentEvent.date,
                        time: currentEvent.time || '',
                        description: currentEvent.description || '',
                        color: 'blue',
                        emoji: detectedEmoji
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
        
        this.events.push(...events);
        this.saveEvents();
        this.renderCalendar();
        this.hideModal('import-modal');
        alert(`Imported ${events.length} events successfully!`);
    }

    parseCSVFile(content) {
        const lines = content.split('\n');
        const events = [];
        
        // Skip header row if it exists
        const startIndex = lines[0].toLowerCase().includes('title') ? 1 : 0;
        
        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const columns = this.parseCSVLine(line);
            if (columns.length >= 2) {
                const title = columns[0];
                const date = this.parseDate(columns[1]);
                const time = columns.length > 2 ? columns[2] : '';
                const description = columns.length > 3 ? columns[3] : '';
                
                if (title && date) {
                    const detectedEmoji = this.detectEmojiFromTitle(title);
                    events.push({
                        id: this.generateId(),
                        title: title,
                        date: date,
                        time: time,
                        description: description,
                        color: 'blue',
                        emoji: detectedEmoji
                    });
                }
            }
        }
        
        this.events.push(...events);
        this.saveEvents();
        this.renderCalendar();
        this.hideModal('import-modal');
        alert(`Imported ${events.length} events successfully!`);
    }

    parseCSVLine(line) {
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

    parseDate(dateString) {
        // Try different date formats
        const formats = [
            /^(\d{4})-(\d{2})-(\d{2})$/,  // YYYY-MM-DD
            /^(\d{2})\/(\d{2})\/(\d{4})$/,  // MM/DD/YYYY
            /^(\d{2})\/(\d{2})\/(\d{2})$/,  // MM/DD/YY
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,  // M/D/YYYY
        ];
        
        for (let format of formats) {
            const match = dateString.match(format);
            if (match) {
                let year, month, day;
                
                if (format.source.startsWith('^(\\d{4})')) {
                    // YYYY-MM-DD
                    year = match[1];
                    month = match[2];
                    day = match[3];
                } else {
                    // MM/DD/YYYY or similar
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

    getEventsForDay(date) {
        const dateString = this.formatDateForInput(date);
        return this.events.filter(event => event.date === dateString);
    }

    isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    formatDateForInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatDateForDisplay(date) {
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        return date.toLocaleDateString('en-US', options);
    }

    generateId() {
        return 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    
    detectEmojiFromTitle(title) {
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

    loadEvents() {
        const stored = localStorage.getItem('familyCalendarEvents');
        return stored ? JSON.parse(stored) : [];
    }

    saveEvents() {
        localStorage.setItem('familyCalendarEvents', JSON.stringify(this.events));
    }
    
    initEmojiPicker() {
        console.log('Initializing emoji picker...');
        
        // Set up emoji button click handler
        const emojiBtn = document.getElementById('emoji-picker-btn');
        if (emojiBtn) {
            console.log('Emoji button found, attaching event listener');
            emojiBtn.onclick = (e) => {
                console.log('Emoji button clicked via onclick');
                e.preventDefault();
                e.stopPropagation();
                this.toggleEmojiPicker();
            };
        } else {
            console.error('Emoji picker button not found');
        }
        
        // Set up emoji option click handlers
        const emojiOptions = document.querySelectorAll('.emoji-option');
        console.log(`Found ${emojiOptions.length} emoji options`);
        
        emojiOptions.forEach((option, index) => {
            console.log(`Setting up emoji option ${index}: ${option.dataset.emoji}`);
            option.onclick = (e) => {
                console.log('Emoji option clicked via onclick:', option.dataset.emoji);
                e.preventDefault();
                e.stopPropagation();
                this.selectEmoji(option.dataset.emoji);
            };
        });
        
        // Set up click outside to close
        document.addEventListener('click', (e) => {
            const emojiSelector = e.target.closest('.emoji-selector');
            const emojiOption = e.target.classList.contains('emoji-option');
            
            if (!emojiSelector && !emojiOption) {
                this.hideEmojiPicker();
            }
        });
    }
    
    toggleEmojiPicker() {
        console.log('toggleEmojiPicker called');
        const emojiPicker = document.getElementById('emoji-picker');
        console.log('Emoji picker element:', emojiPicker);
        
        if (emojiPicker) {
            const isVisible = emojiPicker.classList.contains('show');
            console.log('Current visibility:', isVisible);
            
            if (isVisible) {
                emojiPicker.classList.remove('show');
                console.log('Hiding emoji picker');
            } else {
                emojiPicker.classList.add('show');
                console.log('Showing emoji picker');
            }
            
            console.log('Emoji picker classes after toggle:', emojiPicker.className);
        } else {
            console.error('Emoji picker element not found');
        }
    }
    
    hideEmojiPicker() {
        const emojiPicker = document.getElementById('emoji-picker');
        if (emojiPicker) {
            emojiPicker.classList.remove('show');
        }
    }
    
    selectEmoji(emoji) {
        console.log('selectEmoji called with:', emoji);
        const emojiInput = document.getElementById('event-emoji');
        const emojiBtn = document.getElementById('emoji-picker-btn');
        
        console.log('Elements found:', { emojiInput, emojiBtn });
        
        if (emojiInput && emojiBtn && emoji) {
            emojiInput.value = emoji;
            emojiBtn.textContent = emoji;
            this.hideEmojiPicker();
            console.log('Emoji selected successfully:', emoji);
        } else {
            console.error('Failed to select emoji - missing elements or emoji');
        }
    }
    
    initKebabMenu() {
        const kebabBtn = document.getElementById('kebab-menu-btn');
        const kebabMenu = document.getElementById('kebab-menu');
        const schedulesItem = document.getElementById('schedules-menu-item');
        const exportItem = document.getElementById('export-menu-item');
        const settingsItem = document.getElementById('settings-menu-item');
        
        // Toggle menu on button click
        kebabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleKebabMenu();
        });
        
        // Menu item click handlers
        schedulesItem.addEventListener('click', () => {
            this.hideKebabMenu();
            this.handleSchedulesClick();
        });
        
        exportItem.addEventListener('click', () => {
            this.hideKebabMenu();
            this.handleExportClick();
        });
        
        settingsItem.addEventListener('click', () => {
            this.hideKebabMenu();
            this.handleSettingsClick();
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.floating-menu')) {
                this.hideKebabMenu();
            }
        });
    }
    
    toggleKebabMenu() {
        const kebabMenu = document.getElementById('kebab-menu');
        kebabMenu.classList.toggle('show');
    }
    
    hideKebabMenu() {
        const kebabMenu = document.getElementById('kebab-menu');
        kebabMenu.classList.remove('show');
    }
    
    handleSchedulesClick() {
        console.log('Schedules clicked');
        this.showSchedulesModal();
    }
    
    showSchedulesModal() {
        const modal = document.getElementById('schedules-modal');
        modal.style.display = 'block';
        
        // Set up schedule button event listeners
        this.initScheduleButtons();
    }
    
    initScheduleButtons() {
        // Personal schedules
        const personalBtn = document.getElementById('personal-schedules-btn');
        personalBtn.onclick = () => {
            alert('Personal Schedules\n\nComing soon:\n• Individual family member calendars\n• Color-coding by person\n• Privacy settings\n• Separate event views');
        };
        
        // Recurring events
        const recurringBtn = document.getElementById('recurring-events-btn');
        recurringBtn.onclick = () => {
            alert('Recurring Events\n\nComing soon:\n• Weekly, monthly, yearly repeats\n• Custom recurrence patterns\n• End date options\n• Exception handling');
        };
        
        // School schedules
        const schoolBtn = document.getElementById('school-schedules-btn');
        schoolBtn.onclick = () => {
            alert('School Schedules\n\nComing soon:\n• Import school district calendars\n• Class schedules\n• Assignment due dates\n• School event notifications');
        };
        
        // Work schedules
        const workBtn = document.getElementById('work-schedules-btn');
        workBtn.onclick = () => {
            alert('Work Schedules\n\nComing soon:\n• Sync with Outlook/Google Calendar\n• Meeting reminders\n• Work shift tracking\n• Team calendar sharing');
        };
        
        // Sports schedules
        const sportsBtn = document.getElementById('sports-schedules-btn');
        sportsBtn.onclick = () => {
            alert('Sports Schedules\n\nComing soon:\n• Practice times\n• Game schedules\n• Tournament brackets\n• Team communications');
        };
        
        // Activities schedules
        const activitiesBtn = document.getElementById('activities-schedules-btn');
        activitiesBtn.onclick = () => {
            alert('Activities & Clubs\n\nComing soon:\n• Music lessons\n• Art classes\n• Club meetings\n• Performance dates');
        };
    }
    
    handleExportClick() {
        console.log('Export clicked');
        this.exportEvents();
    }
    
    handleSettingsClick() {
        console.log('Settings clicked');
        alert('Settings feature coming soon!\n\nThis will allow you to:\n• Customize calendar appearance\n• Set default colors and emojis\n• Configure notification preferences\n• Manage family member profiles');
    }
    
    exportEvents() {
        if (this.events.length === 0) {
            alert('No events to export. Please add some events first.');
            return;
        }
        
        // Create CSV content
        const csvHeaders = 'Title,Date,Time,Description,Color,Emoji\n';
        const csvContent = this.events.map(event => {
            const title = `"${event.title.replace(/"/g, '""')}"`;
            const date = event.date;
            const time = event.time || '';
            const description = `"${(event.description || '').replace(/"/g, '""')}"`;
            const color = event.color;
            const emoji = event.emoji || '';
            
            return `${title},${date},${time},${description},${color},${emoji}`;
        }).join('\n');
        
        const fullCsvContent = csvHeaders + csvContent;
        
        // Create and download file
        const blob = new Blob([fullCsvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `family-calendar-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert(`Exported ${this.events.length} events to CSV file!`);
        }
    }
}

// Initialize the calendar when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FamilyCalendar();
});