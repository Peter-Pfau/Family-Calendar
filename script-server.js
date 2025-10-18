class FamilyCalendar {
    constructor() {
        this.currentDate = new Date();
        this.events = [];
        this.currentEditingEvent = null;
        this.useServer = true; // Set to false to use localStorage only
        this.currentUser = null;
        this.currentFamily = null;
        this.currentView = 'calendar'; // 'calendar' or 'list'

        this.checkAuth();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me', {
                credentials: 'include'
            });

            if (!response.ok) {
                // Not authenticated, redirect to login
                window.location.href = '/login.html';
                return;
            }

            const data = await response.json();
            this.currentUser = data.user;
            this.currentFamily = data.family;

            // Update UI with user info
            this.updateUserUI();

            // Initialize app
            this.initializeEventListeners();
            this.loadEvents();
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login.html';
        }
    }

    updateUserUI() {
        // Add user info to header
        const header = document.querySelector('.header');
        if (header && this.currentUser) {
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';
            userInfo.style.cssText = 'display: flex; align-items: center; gap: 15px;';
            userInfo.innerHTML = `
                <span style="font-size: 14px; color: #666;">
                    ${this.currentUser.name} (${this.currentUser.role})
                </span>
                <button id="logout-btn" class="secondary-btn" style="padding: 6px 12px;">Logout</button>
                ${this.currentUser.role === 'admin' ? '<button id="family-admin-btn" class="secondary-btn" style="padding: 6px 12px;">Family Admin</button>' : ''}
            `;
            header.appendChild(userInfo);

            // Logout button
            document.getElementById('logout-btn').addEventListener('click', () => this.logout());

            // Family admin button
            if (this.currentUser.role === 'admin') {
                document.getElementById('family-admin-btn').addEventListener('click', () => this.showFamilyAdmin());
            }
        }
    }

    normalizeEvent(rawEvent) {
        if (!rawEvent) {
            return rawEvent;
        }

        const normalized = { ...rawEvent };

        if (normalized.time === undefined || normalized.time === null) {
            normalized.time = '';
        }

        const recurrenceTypeRaw = normalized.recurrenceType ?? normalized.recurrence_type ?? null;
        const recurrenceIntervalRaw = normalized.recurrenceInterval ?? normalized.recurrence_interval ?? null;
        const recurrenceUntilRaw = normalized.recurrenceUntil ?? normalized.recurrence_until ?? null;

        const recurrenceType = recurrenceTypeRaw ? String(recurrenceTypeRaw).toLowerCase() : null;

        normalized.recurrenceType = recurrenceType || null;
        normalized.recurrenceInterval = normalized.recurrenceType ? (Number(recurrenceIntervalRaw) || 1) : null;
        normalized.recurrenceUntil = recurrenceUntilRaw || null;

        delete normalized.recurrence_type;
        delete normalized.recurrence_interval;
        delete normalized.recurrence_until;

        return normalized;
    }

    normalizeEvents(events = []) {
        return events.map(event => this.normalizeEvent(event));
    }

    isRecurringEvent(event) {
        return !!(event && event.recurrenceType === 'yearly');
    }

    toDate(dateString) {
        if (!dateString) {
            return null;
        }

        const parts = dateString.split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) {
            return null;
        }

        const [year, month, day] = parts;
        const date = new Date(year, month - 1, day);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    occursOnDate(event, targetDate) {
        if (!event || !event.date) {
            return false;
        }

        const formattedTarget = this.formatDateForInput(targetDate);
        if (event.date === formattedTarget) {
            return true;
        }

        if (!this.isRecurringEvent(event)) {
            return false;
        }

        const baseDate = this.toDate(event.date);
        const compareDate = new Date(targetDate);
        compareDate.setHours(0, 0, 0, 0);

        if (!baseDate || compareDate < baseDate) {
            return false;
        }

        if (event.recurrenceUntil) {
            const untilDate = this.toDate(event.recurrenceUntil);
            if (untilDate && compareDate > untilDate) {
                return false;
            }
        }

        switch (event.recurrenceType) {
            case 'yearly':
                return baseDate.getMonth() === compareDate.getMonth() &&
                    baseDate.getDate() === compareDate.getDate();
            default:
                return false;
        }
    }

    createOccurrenceInstance(event, targetDate) {
        const occurrenceDate = this.formatDateForInput(targetDate);
        return {
            ...event,
            occurrenceDate,
            isRecurringInstance: this.isRecurringEvent(event) && occurrenceDate !== event.date
        };
    }

    parseTimeToMinutes(timeString) {
        if (!timeString) {
            return Number.MAX_SAFE_INTEGER;
        }

        const parts = timeString.split(':').map(Number);
        if (parts.length < 2 || parts.some(Number.isNaN)) {
            return Number.MAX_SAFE_INTEGER;
        }

        const [hours, minutes] = parts;
        return hours * 60 + minutes;
    }

    getNextOccurrenceDate(event, fromDate) {
        if (!event || !event.date) {
            return null;
        }

        const startDate = new Date(fromDate);
        startDate.setHours(0, 0, 0, 0);

        const baseDate = this.toDate(event.date);
        if (!baseDate) {
            return null;
        }

        if (baseDate >= startDate) {
            return baseDate;
        }

        if (!this.isRecurringEvent(event)) {
            return null;
        }

        const interval = event.recurrenceInterval && Number(event.recurrenceInterval) > 0
            ? Number(event.recurrenceInterval)
            : 1;

        const candidate = new Date(baseDate);
        candidate.setHours(0, 0, 0, 0);

        let safety = 0;
        while (candidate < startDate && safety < 500) {
            if (event.recurrenceType === 'yearly') {
                candidate.setFullYear(candidate.getFullYear() + interval);
            } else {
                break;
            }
            safety += 1;
        }

        if (safety >= 500) {
            return null;
        }

        if (event.recurrenceUntil) {
            const untilDate = this.toDate(event.recurrenceUntil);
            if (untilDate && candidate > untilDate) {
                return null;
            }
        }

        return candidate >= startDate ? candidate : null;
    }

    calculateListHorizon(startDate) {
        let furthest = new Date(startDate);

        const nextOccurrences = this.events
            .map(event => this.getNextOccurrenceDate(event, startDate))
            .filter(date => date);

        if (nextOccurrences.length > 0) {
            furthest = nextOccurrences.reduce((maxDate, date) => date > maxDate ? date : maxDate, furthest);
        }

        const defaultHorizon = new Date(startDate);
        defaultHorizon.setDate(defaultHorizon.getDate() + 60);
        if (defaultHorizon > furthest) {
            furthest = defaultHorizon;
        }

        return furthest;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout failed:', error);
            alert('Failed to logout. Please try again.');
        }
    }

    async showFamilyAdmin() {
        // Create modal if it doesn't exist
        let modal = document.getElementById('family-admin-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'family-admin-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <div class="modal-header">
                        <h2>Family Administration</h2>
                        <span class="close" id="close-family-admin">&times;</span>
                    </div>
                    <div style="margin: 20px 0;">
                        <h3 style="margin-bottom: 15px;">Family Members</h3>
                        <div id="family-members-list"></div>
                        <div style="margin-top: 20px;">
                            <h3 style="margin-bottom: 10px;">Invite New Member</h3>
                            <form id="invite-form" style="display: flex; gap: 10px; align-items: end;">
                                <div class="form-group" style="flex: 1; margin: 0;">
                                    <label for="invite-email">Email:</label>
                                    <input type="email" id="invite-email" required>
                                </div>
                                <div class="form-group" style="width: 150px; margin: 0;">
                                    <label for="invite-role">Role:</label>
                                    <select id="invite-role">
                                        <option value="adult">Adult</option>
                                        <option value="child">Child</option>
                                    </select>
                                </div>
                                <button type="submit" class="primary-btn" style="padding: 12px 20px;">Send Invite</button>
                            </form>
                        </div>
                        <div style="margin-top: 20px;">
                            <h3 style="margin-bottom: 10px;">Pending Invitations</h3>
                            <div id="pending-invitations-list"></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close button
            document.getElementById('close-family-admin').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            // Invite form
            document.getElementById('invite-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.sendInvitation();
            });
        }

        // Load family data
        await this.loadFamilyData();

        modal.style.display = 'block';
    }

    async loadFamilyData() {
        try {
            // Load family members
            const membersResponse = await fetch('/api/family/members', {
                credentials: 'include'
            });
            const members = await membersResponse.json();

            const membersList = document.getElementById('family-members-list');
            membersList.innerHTML = members.map(member => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px;">
                    <div>
                        <strong>${member.name}</strong>
                        <span style="color: #666; font-size: 13px; margin-left: 10px;">${member.email}</span>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        ${member.id === this.currentUser.id ?
                            `<span style="color: #667eea; font-weight: 600;">${member.role} (You)</span>` :
                            `<select data-user-id="${member.id}" class="role-select" style="padding: 4px 8px;">
                                <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                                <option value="adult" ${member.role === 'adult' ? 'selected' : ''}>Adult</option>
                                <option value="child" ${member.role === 'child' ? 'selected' : ''}>Child</option>
                            </select>
                            <button class="danger-btn" onclick="familyCalendar.removeMember('${member.id}')" style="padding: 4px 12px; font-size: 13px;">Remove</button>`
                        }
                    </div>
                </div>
            `).join('');

            // Role change listeners
            document.querySelectorAll('.role-select').forEach(select => {
                select.addEventListener('change', async (e) => {
                    const userId = e.target.dataset.userId;
                    const newRole = e.target.value;
                    await this.updateMemberRole(userId, newRole);
                });
            });

            // Load pending invitations
            const invitationsResponse = await fetch('/api/family/invitations', {
                credentials: 'include'
            });
            const invitations = await invitationsResponse.json();

            const invitationsList = document.getElementById('pending-invitations-list');
            if (invitations.length === 0) {
                invitationsList.innerHTML = '<p style="color: #999; font-size: 14px;">No pending invitations</p>';
            } else {
                invitationsList.innerHTML = invitations.filter(inv => inv.status === 'pending').map(inv => `
                    <div style="padding: 10px; background: #fff3cd; border-radius: 6px; margin-bottom: 6px;">
                        <strong>${inv.email}</strong>
                        <span style="color: #666; font-size: 13px; margin-left: 10px;">as ${inv.role}</span>
                        <span style="color: #999; font-size: 12px; margin-left: 10px;">Expires: ${new Date(inv.expiresAt).toLocaleDateString()}</span>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error loading family data:', error);
            alert('Failed to load family data');
        }
    }

    async sendInvitation() {
        const email = document.getElementById('invite-email').value;
        const role = document.getElementById('invite-role').value;

        try {
            const response = await fetch('/api/family/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, role })
            });

            const result = await response.json();

            if (response.ok) {
                alert(`Invitation sent to ${email}!`);
                document.getElementById('invite-form').reset();
                await this.loadFamilyData();
            } else {
                alert(result.error || 'Failed to send invitation');
            }
        } catch (error) {
            console.error('Error sending invitation:', error);
            alert('Failed to send invitation');
        }
    }

    async updateMemberRole(userId, newRole) {
        try {
            const response = await fetch(`/api/family/members/${userId}/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ role: newRole })
            });

            if (response.ok) {
                alert('Role updated successfully');
            } else {
                const result = await response.json();
                alert(result.error || 'Failed to update role');
                await this.loadFamilyData(); // Reload to reset select
            }
        } catch (error) {
            console.error('Error updating role:', error);
            alert('Failed to update role');
        }
    }

    async removeMember(userId) {
        if (!confirm('Are you sure you want to remove this family member?')) {
            return;
        }

        try {
            const response = await fetch(`/api/family/members/${userId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                alert('Member removed successfully');
                await this.loadFamilyData();
            } else {
                const result = await response.json();
                alert(result.error || 'Failed to remove member');
            }
        } catch (error) {
            console.error('Error removing member:', error);
            alert('Failed to remove member');
        }
    }

    async initializeEventListeners() {
        // Navigation buttons
        document.getElementById('prev-month').addEventListener('click', () => this.navigateMonth(-1));
        document.getElementById('next-month').addEventListener('click', () => this.navigateMonth(1));
        document.getElementById('today-btn').addEventListener('click', () => this.goToToday());
        
        // View toggle button
        document.getElementById('view-toggle-btn').addEventListener('click', () => this.toggleView());

        // Add event button
        document.getElementById('add-event-btn').addEventListener('click', () => this.showAddEventModal());

        // Import button
        document.getElementById('import-btn').addEventListener('click', () => this.showImportModal());
        
        // Modal close buttons
        document.getElementById('close-modal').addEventListener('click', () => this.hideModal('event-modal'));
        document.getElementById('close-import-modal').addEventListener('click', () => this.hideModal('import-modal'));
        document.getElementById('close-details-modal').addEventListener('click', () => this.hideModal('event-details-modal'));
        
        // Form buttons
        document.getElementById('cancel-btn').addEventListener('click', () => this.hideModal('event-modal'));
        document.getElementById('close-details-btn').addEventListener('click', () => this.hideModal('event-details-modal'));
        document.getElementById('delete-event-btn').addEventListener('click', () => this.deleteCurrentEvent());
        document.getElementById('edit-event-btn').addEventListener('click', () => this.editEventFromDetails());
        
        // Event form submission
        document.getElementById('event-form').addEventListener('submit', (e) => this.handleEventSubmit(e));
        
        // File upload
        document.getElementById('upload-btn').addEventListener('click', () => this.handleFileUpload());
        
        // Emoji picker functionality
        const emojiBtn = document.getElementById('emoji-picker-btn');
        if (emojiBtn) {
            emojiBtn.addEventListener('click', (e) => {
                console.log('Emoji button clicked');
                e.preventDefault();
                e.stopPropagation();
                this.toggleEmojiPicker();
            });
        } else {
            console.error('Emoji picker button not found during initialization');
        }
        
        // Emoji selection - delegate to document to catch all emoji options
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-option')) {
                console.log('Emoji option clicked:', e.target.dataset.emoji);
                e.preventDefault();
                e.stopPropagation();
                this.selectEmoji(e.target.dataset.emoji);
            }
        });
        
        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideModal(e.target.id);
            }
            // Close emoji picker when clicking outside
            if (!e.target.closest('.emoji-selector') && !e.target.classList.contains('emoji-option')) {
                this.hideEmojiPicker();
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

        const recurringCheckbox = document.getElementById('event-recurring');
        if (recurringCheckbox) {
            recurringCheckbox.checked = false;
        }
        
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
        const baseDate = this.toDate(event.date);
        const occurrenceDateString = event.occurrenceDate || event.date;
        const occurrenceDate = this.toDate(occurrenceDateString) || baseDate || new Date();
        const formattedDate = this.formatDateForDisplay(occurrenceDate);
        const recurrenceMarkup = this.isRecurringEvent(event) ? `
            <div class="detail-item">
                <div class="detail-label">Repeats:</div>
                <div class="detail-value">Every year</div>
            </div>
        ` : '';
        
        content.innerHTML = `
            <div class="detail-item">
                <div class="detail-label">Title:</div>
                <div class="detail-value">${titleWithEmoji}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Date:</div>
                <div class="detail-value">${formattedDate}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Time:</div>
                <div class="detail-value">${event.time || 'All day'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Description:</div>
                <div class="detail-value">${event.description || 'No description'}</div>
            </div>
            ${recurrenceMarkup}
        `;
        
        const baseEventReference = this.events.find(e => e.id === event.id) || event;
        this.currentEditingEvent = { ...baseEventReference };
        if (event.occurrenceDate) {
            this.currentEditingEvent.occurrenceDate = event.occurrenceDate;
        }
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

        const recurringCheckbox = document.getElementById('event-recurring');
        if (recurringCheckbox) {
            recurringCheckbox.checked = this.isRecurringEvent(this.currentEditingEvent);
        }
        
        modal.style.display = 'block';
    }

    showImportModal() {
        const modal = document.getElementById('import-modal');
        modal.style.display = 'block';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    async handleEventSubmit(e) {
        e.preventDefault();
        
        const title = document.getElementById('event-title').value;
        const date = document.getElementById('event-date').value;
        const time = document.getElementById('event-time').value;
        const description = document.getElementById('event-description').value;
        const color = document.getElementById('event-color').value;
        const emoji = document.getElementById('event-emoji').value;
        const isRecurring = document.getElementById('event-recurring').checked;
        
        const eventData = {
            title,
            date,
            time,
            description,
            color,
            emoji,
            recurrenceType: isRecurring ? 'yearly' : null,
            recurrenceInterval: isRecurring ? 1 : null,
            recurrenceUntil: null
        };
        
        try {
            if (this.currentEditingEvent) {
                // Update existing event
                await this.updateEvent(this.currentEditingEvent.id, eventData);
            } else {
                // Add new event
                await this.createEvent(eventData);
            }

            await this.loadEvents();
            this.refreshCurrentView();
            this.hideModal('event-modal');
        } catch (error) {
            console.error('Error saving event:', error);
            alert('Failed to save event. Please try again.');
        }
    }

    async deleteCurrentEvent() {
        if (this.currentEditingEvent) {
            try {
                await this.deleteEvent(this.currentEditingEvent.id);
                await this.loadEvents();
                this.refreshCurrentView();
                this.hideModal('event-modal');
            } catch (error) {
                console.error('Error deleting event:', error);
                alert('Failed to delete event. Please try again.');
            }
        }
    }

    refreshCurrentView() {
        if (this.currentView === 'calendar') {
            this.renderCalendar();
        } else {
            this.renderListView();
        }
    }

    async handleFileUpload() {
        const fileInput = document.getElementById('file-input');
        const file = fileInput.files[0];
        
        if (!file) {
            alert('Please select a file to upload.');
            return;
        }
        
        if (this.useServer) {
            // Upload to server
            const formData = new FormData();
            formData.append('calendarFile', file);
            
            try {
                const response = await fetch('/api/import', {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    await this.loadEvents();
                    this.refreshCurrentView();
                    this.hideModal('import-modal');
                    alert(result.message);
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Error uploading file:', error);
                alert('Failed to import calendar. Please try again.');
            }
        } else {
            // Use client-side parsing (fallback to original method)
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
    }

    // Server API methods
    async loadEvents() {
        if (this.useServer) {
            try {
                const response = await fetch('/api/events', {
                    credentials: 'include'
                });
                if (response.ok) {
                    const rawEvents = await response.json();
                    this.events = this.normalizeEvents(rawEvents);
                    console.log('📅 Loaded events from server:', this.events);
                } else {
                    throw new Error('Failed to load events from server');
                }
            } catch (error) {
                console.warn('Server not available, falling back to localStorage:', error);
                this.useServer = false;
                this.loadEventsFromLocalStorage();
            }
        } else {
            this.loadEventsFromLocalStorage();
        }

        console.log('📊 Total events in memory:', this.events.length);
        this.renderCalendar();
    }

    async createEvent(eventData) {
        if (this.useServer) {
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(eventData)
            });

            if (!response.ok) {
                throw new Error('Failed to create event');
            }

            return await response.json();
        } else {
            const event = this.normalizeEvent({
                id: this.generateId(),
                ...eventData
            });
            this.events.push(event);
            this.saveEventsToLocalStorage();
            return event;
        }
    }

    async updateEvent(id, eventData) {
        if (this.useServer) {
            const response = await fetch(`/api/events/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(eventData)
            });

            if (!response.ok) {
                throw new Error('Failed to update event');
            }

            return await response.json();
        } else {
            const index = this.events.findIndex(e => e.id === id);
            if (index > -1) {
                this.events[index] = this.normalizeEvent({ ...this.events[index], ...eventData });
                this.saveEventsToLocalStorage();
            }
        }
    }

    async deleteEvent(id) {
        if (this.useServer) {
            const response = await fetch(`/api/events/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Failed to delete event');
            }
            
            return await response.json();
        } else {
            const index = this.events.findIndex(e => e.id === id);
            if (index > -1) {
                this.events.splice(index, 1);
                this.saveEventsToLocalStorage();
            }
        }
    }

    // localStorage fallback methods
    loadEventsFromLocalStorage() {
        const stored = localStorage.getItem('familyCalendarEvents');
        const parsed = stored ? JSON.parse(stored) : [];
        this.events = this.normalizeEvents(parsed);
    }

    saveEventsToLocalStorage() {
        localStorage.setItem('familyCalendarEvents', JSON.stringify(this.events));
    }

    // Client-side parsing methods (kept for fallback)
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
                    events.push(this.normalizeEvent({
                        id: this.generateId(),
                        title: currentEvent.title,
                        date: currentEvent.date,
                        time: currentEvent.time || '',
                        description: currentEvent.description || '',
                        color: 'blue',
                        emoji: ''
                    }));
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
        this.saveEventsToLocalStorage();
        this.renderCalendar();
        this.hideModal('import-modal');
        alert(`Imported ${events.length} events successfully!`);
    }

    parseCSVFile(content) {
        const lines = content.split('\n');
        const events = [];
        
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
                    events.push(this.normalizeEvent({
                        id: this.generateId(),
                        title: title,
                        date: date,
                        time: time,
                        description: description,
                        color: 'blue',
                        emoji: ''
                    }));
                }
            }
        }
        
        this.events.push(...events);
        this.saveEventsToLocalStorage();
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

    getEventsForDay(date) {
        const formattedDate = this.formatDateForInput(date);
        const eventsForDay = [];

        this.events.forEach(event => {
            if (!event || !event.date) {
                return;
            }

            if (event.date === formattedDate) {
                eventsForDay.push(this.createOccurrenceInstance(event, date));
                return;
            }

            if (this.occursOnDate(event, date)) {
                eventsForDay.push(this.createOccurrenceInstance(event, date));
            }
        });

        eventsForDay.sort((a, b) => this.parseTimeToMinutes(a.time) - this.parseTimeToMinutes(b.time));

        if (eventsForDay.length > 0) {
            console.log(`Events for ${formattedDate}:`, eventsForDay);
        }

        return eventsForDay;
    }

    isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    toggleView() {
        if (this.currentView === 'calendar') {
            this.currentView = 'list';
            document.getElementById('calendar-view').style.display = 'none';
            document.getElementById('list-view').style.display = 'block';
            document.getElementById('view-toggle-btn').innerHTML = '📅 Calendar View';
            this.renderListView();
        } else {
            this.currentView = 'calendar';
            document.getElementById('calendar-view').style.display = 'block';
            document.getElementById('list-view').style.display = 'none';
            document.getElementById('view-toggle-btn').innerHTML = '📋 List View';
        }
    }

    renderListView() {
        const listContainer = document.getElementById('list-events');
        listContainer.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = this.calculateListHorizon(today);
        const cursor = new Date(today);

        while (cursor <= endDate) {
            const currentDate = new Date(cursor);
            const dayEvents = this.getEventsForDay(currentDate);

            const dayCard = document.createElement('div');
            dayCard.className = 'list-day-card';
            if (this.isSameDay(currentDate, today)) {
                dayCard.classList.add('today');
            }

            const header = document.createElement('div');
            header.className = 'list-day-header';

            const dayLabel = document.createElement('div');
            dayLabel.className = 'list-day-date';
            if (this.isSameDay(currentDate, today)) {
                dayLabel.classList.add('today');
            }
            dayLabel.textContent = currentDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });

            const count = document.createElement('div');
            count.className = 'list-day-count';
            count.textContent = dayEvents.length === 0 ? 'No events' : `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`;

            header.appendChild(dayLabel);
            header.appendChild(count);

            const eventsWrapper = document.createElement('div');
            eventsWrapper.className = 'list-day-events';

            if (dayEvents.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'list-day-empty';
                emptyState.textContent = 'No events scheduled';
                eventsWrapper.appendChild(emptyState);
            } else {
                dayEvents.forEach(event => {
                    const eventRow = document.createElement('div');
                    eventRow.className = 'list-day-event';
                    eventRow.addEventListener('click', () => this.showEventDetails(event));

                    const colorDot = document.createElement('span');
                    colorDot.className = `list-day-event-color ${event.color || 'blue'}`;

                    const time = document.createElement('span');
                    time.className = 'list-day-event-time';
                    time.textContent = event.time ? event.time : 'All day';

                    const content = document.createElement('div');
                    content.className = 'list-day-event-content';

                    const title = document.createElement('div');
                    title.className = 'list-day-event-title';
                    if (event.emoji) {
                        const emoji = document.createElement('span');
                        emoji.className = 'list-day-event-emoji';
                        emoji.textContent = event.emoji;
                        title.appendChild(emoji);
                    }
                    const titleText = document.createElement('span');
                    titleText.textContent = event.title;
                    title.appendChild(titleText);
                    content.appendChild(title);

                    if (event.description) {
                        const description = document.createElement('div');
                        description.className = 'list-day-event-description';
                        description.textContent = event.description;
                        content.appendChild(description);
                    }

                    eventRow.appendChild(colorDot);
                    eventRow.appendChild(time);
                    eventRow.appendChild(content);
                    eventsWrapper.appendChild(eventRow);
                });
            }

            dayCard.appendChild(header);
            dayCard.appendChild(eventsWrapper);
            listContainer.appendChild(dayCard);

            cursor.setDate(cursor.getDate() + 1);
        }

        listContainer.scrollTop = 0;
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
    
    toggleEmojiPicker() {
        console.log('toggleEmojiPicker called');
        const emojiPicker = document.getElementById('emoji-picker');
        console.log('Emoji picker element:', emojiPicker);
        if (emojiPicker) {
            emojiPicker.classList.toggle('show');
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
}

// Initialize the calendar when the page loads
let familyCalendar; // Global variable for onclick handlers
document.addEventListener('DOMContentLoaded', () => {
    familyCalendar = new FamilyCalendar();
});
