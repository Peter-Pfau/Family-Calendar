const BACKGROUND_MAX_SIZE = 1.5 * 1024 * 1024;
const BACKGROUND_STORAGE_KEY = 'familyCalendarBackgrounds';

class FamilyCalendar {
    constructor() {
        this.currentDate = new Date();
        this.events = [];
        this.currentEditingEvent = null;
        this.dayBackgrounds = {};
        this.currentBackgroundDate = null;
        this.backgroundPreviewData = null;
        this.backgroundFileDirty = false;
        this.useServer = true; // Set to false to use localStorage only
        this.currentUser = null;
        this.currentFamily = null;
        this.currentView = 'calendar'; // 'calendar' or 'list'
        this.sessionLogLimit = 50;

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

            if ((!this.currentFamily || !this.currentFamily.id) && this.currentUser) {
                const fallbackFamilyId = this.currentUser.familyId || this.currentUser.family_id || null;
                const fallbackFamilyName = this.currentUser.familyName || this.currentUser.family_name || null;
                if (fallbackFamilyId || fallbackFamilyName) {
                    this.currentFamily = {
                        id: fallbackFamilyId,
                        name: fallbackFamilyName
                    };
                }
            }

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
        const familyNameDisplay = document.getElementById('current-family-name');
        const activeFamilyName = [
            this.currentFamily?.name,
            this.currentFamily?.familyName,
            this.currentFamily?.family_name,
            this.currentUser?.familyName,
            this.currentUser?.family_name
        ].find((value) => value && String(value).trim().length > 0) || '';

        if (familyNameDisplay) {
            const nameText = activeFamilyName || 'Unknown';
            familyNameDisplay.textContent = `Family: ${nameText}`;
            familyNameDisplay.style.display = 'block';
        }

        if (header) {
            const existingInfo = header.querySelector('.user-info');
            if (existingInfo) {
                existingInfo.remove();
            }
        }

        if (header && this.currentUser) {
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';
            userInfo.style.cssText = 'display: flex; align-items: center; gap: 15px;';
            userInfo.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-size: 14px; color: #666;">
                        ${this.currentUser.name} (${this.currentUser.role})
                    </span>
                </div>
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
                <div class="modal-content wide">
                    <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <h2 style="margin: 0;">Family Administration</h2>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button id="member-list-btn" class="secondary-btn" style="padding: 6px 12px;">Members</button>
                            <button id="session-log-btn" class="secondary-btn" style="padding: 6px 12px;">Session Log</button>
                            <button id="test-email-btn" class="secondary-btn" style="padding: 6px 12px;">Test Email</button>
                            <button id="close-family-admin" class="icon-btn" aria-label="Close" style="background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer;">&times;</button>
                        </div>
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

            // Session log button
            document.getElementById('session-log-btn').addEventListener('click', () => this.showSessionLogModal());

            // Member list button
            document.getElementById('member-list-btn').addEventListener('click', () => this.showMemberListModal());

            // Test email button
            document.getElementById('test-email-btn').addEventListener('click', () => this.sendTestEmail());

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
            const currentUserId = this.currentUser?.id;
            const adminCount = members.filter((member) => member.role === 'admin').length;

            const membersList = document.getElementById('family-members-list');
            membersList.innerHTML = members.map(member => {
                const memberName = member.name || 'Unnamed Member';
                const memberEmail = member.email || 'No email provided';
                const memberFamilyName = member.familyName || member.family_name || '';
                const isSelf = currentUserId && member.id === currentUserId;
                const isLastAdmin = member.role === 'admin' && adminCount <= 1;

                const managementControls = isSelf
                    ? `<span style="color: #667eea; font-weight: 600;">${member.role} (You)</span>`
                    : `<div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
                            <select data-user-id="${member.id}" class="member-role-select" ${isLastAdmin ? 'disabled' : ''} style="padding: 4px 8px;">
                                <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                                <option value="adult" ${member.role === 'adult' ? 'selected' : ''}>Adult</option>
                                <option value="child" ${member.role === 'child' ? 'selected' : ''}>Child</option>
                            </select>
                            <button class="danger-btn member-remove-btn" data-user-id="${member.id}" ${isLastAdmin ? 'disabled title="Family must have at least one admin"' : ''} style="padding: 4px 12px; font-size: 13px;">Remove</button>
                        </div>
                        ${isLastAdmin ? '<div style="color: #c53030; font-size: 12px;">Cannot modify or remove the only admin.</div>' : ''}`;

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px;">
                        <div>
                            <strong>${memberName}</strong>
                            <div style="color: #666; font-size: 13px; margin-top: 4px;">${memberEmail}</div>
                            ${memberFamilyName ? `<div style="color: #4a5568; font-size: 12px; margin-top: 2px;">Family: ${memberFamilyName}</div>` : ''}
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                            ${managementControls}
                        </div>
                    </div>
                `;
            }).join('');

            // Role change listeners
            membersList.querySelectorAll('.member-role-select').forEach(select => {
                if (select.disabled) {
                    return;
                }

                select.addEventListener('change', async (e) => {
                    const userId = e.target.dataset.userId;
                    const newRole = e.target.value;
                    await this.updateMemberRole(userId, newRole);
                });
            });

            membersList.querySelectorAll('.member-remove-btn').forEach(button => {
                if (button.disabled) {
                    return;
                }

                button.addEventListener('click', (e) => {
                    const userId = e.currentTarget.dataset.userId;
                    this.removeMember(userId);
                });
            });

            // Load pending invitations
            const invitationsResponse = await fetch('/api/family/invitations', {
                credentials: 'include'
            });
            const invitations = await invitationsResponse.json();

            const invitationsList = document.getElementById('pending-invitations-list');
            const pendingInvitations = invitations.filter(inv => inv.status === 'pending');
            if (pendingInvitations.length === 0) {
                invitationsList.innerHTML = '<p style="color: #999; font-size: 14px;">No pending invitations</p>';
            } else {
                invitationsList.innerHTML = pendingInvitations.map(inv => `
                    <div class="invitation-row" data-invite-id="${inv.id}" style="padding: 10px; background: #fff3cd; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 12px; align-items: center;">
                        <div style="flex: 1; min-width: 0;">
                            <strong>${inv.email}</strong>
                            <span style="color: #666; font-size: 13px; margin-left: 10px;">Role: ${inv.role}</span>
                            <div style="color: #999; font-size: 12px; margin-top: 4px;">${this.renderInvitationExpiry(inv.expiresAt || inv.expires_at)}</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="secondary-btn invitation-resend-btn" data-invite-id="${inv.id}" style="padding: 6px 12px;">Resend</button>
                            <button class="danger-btn invitation-cancel-btn" data-invite-id="${inv.id}" style="padding: 6px 12px;">Cancel</button>
                        </div>
                    </div>
                `).join('');

                invitationsList.querySelectorAll('.invitation-resend-btn').forEach(button => {
                    button.addEventListener('click', async (event) => {
                        const inviteId = event.currentTarget.dataset.inviteId;
                        await this.resendInvitation(inviteId, event.currentTarget);
                    });
                });

                invitationsList.querySelectorAll('.invitation-cancel-btn').forEach(button => {
                    button.addEventListener('click', async (event) => {
                        const inviteId = event.currentTarget.dataset.inviteId;
                        await this.cancelInvitation(inviteId, event.currentTarget);
                    });
                });
            }
        } catch (error) {
            console.error('Error loading family data:', error);
            alert('Failed to load family data');
        }
    }

    async showSessionLogModal() {
        let modal = document.getElementById('session-log-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'session-log-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content padded" style="max-width: 720px;">
                    <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <h2 style="margin: 0;">Session Log</h2>
                        <button id="close-session-log" class="icon-btn" aria-label="Close" style="background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer;">&times;</button>
                    </div>
                    <div style="margin: 20px 0;">
                        <div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label for="session-log-limit" style="font-weight: 600;">Show</label>
                                <select id="session-log-limit" style="padding: 6px 10px;">
                                    <option value="25">25</option>
                                    <option value="50">50</option>
                                    <option value="100">100</option>
                                    <option value="200">200</option>
                                </select>
                                <span style="font-size: 14px; color: #555;">recent sessions</span>
                            </div>
                            <button id="session-log-refresh" class="secondary-btn" style="padding: 6px 12px;">Refresh</button>
                        </div>
                        <p id="session-log-status" style="color: #666; font-size: 13px; margin: 12px 0 0;"></p>
                        <div id="session-log-list" style="margin-top: 15px; max-height: 400px; overflow-y: auto;"></div>
                    </div>
                </div>
            `;
        document.body.appendChild(modal);

        document.getElementById('close-session-log').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        document.getElementById('session-log-refresh').addEventListener('click', () => this.loadSessionLog());

        document.getElementById('session-log-limit').addEventListener('change', (event) => {
            this.sessionLogLimit = parseInt(event.target.value, 10) || 50;
            this.loadSessionLog();
        });
    }

    const limitSelect = document.getElementById('session-log-limit');
        if (limitSelect) {
            limitSelect.value = String(this.sessionLogLimit);
        }

        modal.style.display = 'block';
        await this.loadSessionLog();
    }

    async loadSessionLog() {
        const list = document.getElementById('session-log-list');
        const status = document.getElementById('session-log-status');
        if (!list) {
            return;
        }

        const limit = this.sessionLogLimit || 50;

        list.innerHTML = '<p style="color: #666;">Loading sessions...</p>';
        if (status) {
            status.textContent = '';
        }

        try {
            const response = await fetch(`/api/admin/sessions?limit=${limit}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const data = await response.json();
            this.renderSessionLog(data.sessions || []);
            if (status) {
                status.textContent = `Showing ${data.count || 0} of the latest ${data.limit || limit} sessions`;
            }
        } catch (error) {
            console.error('Failed to load session log:', error);
            list.innerHTML = '<p style="color: #c53030;">Failed to load session log. Please try again.</p>';
            if (status) {
                status.textContent = '';
            }
        }
    }

    renderSessionLog(sessions) {
        const list = document.getElementById('session-log-list');
        if (!list) {
            return;
        }

        if (!sessions || sessions.length === 0) {
            list.innerHTML = '<p style="color: #666;">No recent sessions found.</p>';
            return;
        }

        list.innerHTML = sessions.map((session) => {
            const displayName = session.userName || session.userEmail || 'Unknown user';
            const emailLine = session.userEmail ? `<div style="color: #666; font-size: 13px;">${session.userEmail}</div>` : '';
            const role = session.userRole || 'Unknown';
            const statusText = session.isExpired ? 'Expired' : 'Active';
            const statusColor = session.isExpired ? '#c53030' : '#2f855a';
            const expiresText = session.expiresAt ? this.formatDateTime(session.expiresAt) : 'N/A';
            const shortSid = session.sid ? `${session.sid.substring(0, 12)}…` : 'N/A';
            const cookie = session.cookie || {};
            const secureBadge = cookie.secure
                ? '<span style="background: #c6f6d5; padding: 4px 8px; border-radius: 9999px;">Secure</span>'
                : '<span style="background: #fed7d7; padding: 4px 8px; border-radius: 9999px;">Secure: No</span>';
            const httpOnlyBadge = cookie.httpOnly
                ? '<span style="background: #c6f6d5; padding: 4px 8px; border-radius: 9999px;">HTTP Only</span>'
                : '<span style="background: #fed7d7; padding: 4px 8px; border-radius: 9999px;">HTTP Only: No</span>';
            const sameSiteBadge = cookie.sameSite
                ? `<span style="background: #e9d8fd; padding: 4px 8px; border-radius: 9999px;">SameSite: ${cookie.sameSite}</span>`
                : '';
            const userIdLine = session.userId ? `<div style="color: #888; font-size: 12px;">User ID: ${session.userId}</div>` : '';

            return `
                <div style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 10px; background: #fff;">
                    <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                        <div>
                            <strong>${displayName}</strong>
                            ${emailLine}
                            <div style="color: #4a5568; font-size: 13px;">Role: ${role}</div>
                            ${userIdLine}
                        </div>
                        <div style="text-align: right; min-width: 180px;">
                            <div style="font-size: 13px; color: #4a5568;">Expires: ${expiresText}</div>
                            <div style="font-size: 12px; color: ${statusColor}; font-weight: 600;">${statusText}</div>
                        </div>
                    </div>
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #4a5568;">
                        <span style="background: #edf2f7; padding: 4px 8px; border-radius: 9999px;">Session: ${shortSid}</span>
                        ${secureBadge}
                        ${httpOnlyBadge}
                        ${sameSiteBadge}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderInvitationExpiry(rawValue) {
        const expiresAt = rawValue || rawValue === 0 ? rawValue : null;
        if (!expiresAt) {
            return 'Expires: Unknown';
        }

        try {
            const expiresDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
            if (Number.isNaN(expiresDate.getTime())) {
                return 'Expires: Unknown';
            }

            const now = new Date();
            const isExpired = expiresDate < now;
            const dateText = expiresDate.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            const prefix = isExpired ? 'Expired' : 'Expires';

            return `${prefix}: ${dateText}`;
        } catch (error) {
            return 'Expires: Unknown';
        }
    }

    async sendTestEmail() {
        const btn = document.getElementById('test-email-btn');
        if (!btn) {
            return;
        }

        try {
            btn.disabled = true;
            btn.textContent = 'Sending...';

            const response = await fetch('/api/admin/test-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: this.currentUser?.email })
            });

            const result = await response.json();

            if (response.ok) {
                const statusLine = result.success
                    ? 'Gmail SMTP reported: email sent successfully.'
                    : `Gmail SMTP did not send the email: ${result.message || 'Unknown reason.'}`;
                const configLine = `Email delivery configured: ${result.emailConfigured ? 'Yes' : 'No'}`;
                alert(`Test email response\n\nTarget: ${result.targetEmail}\n${statusLine}\n${configLine}`);
            } else {
                alert(result.error || 'Failed to send test email.');
            }
        } catch (error) {
            console.error('Failed to send test email:', error);
            alert('Failed to send test email. Check logs for details.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Test Email';
        }
    }

    async showMemberListModal() {
        let modal = document.getElementById('member-list-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'member-list-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content padded" style="max-width: 650px;">
                    <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <h2 style="margin: 0;">Family Members</h2>
                        <button id="close-member-list" class="icon-btn" aria-label="Close" style="background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer;">&times;</button>
                    </div>
                    <div style="margin: 20px 0;">
                        <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center;">
                            <span style="font-size: 14px; color: #555;">Summary of current family members.</span>
                            <button id="member-list-refresh" class="secondary-btn" style="padding: 6px 12px;">Refresh</button>
                        </div>
                        <p id="member-list-status" style="color: #666; font-size: 13px; margin: 12px 0 0;"></p>
                        <div id="member-list-container" style="margin-top: 15px; max-height: 400px; overflow-y: auto;"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('close-member-list').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            document.getElementById('member-list-refresh').addEventListener('click', () => this.loadMemberList());
        }

        modal.style.display = 'block';
        await this.loadMemberList();
    }

    async loadMemberList() {
        const container = document.getElementById('member-list-container');
        const status = document.getElementById('member-list-status');
        if (!container) {
            return;
        }

        container.innerHTML = '<p style="color: #666;">Loading members...</p>';
        if (status) {
            status.textContent = '';
        }

        try {
            const response = await fetch('/api/family/members', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const members = await response.json();
            this.renderMemberList(members);

            if (status) {
                const adminCount = members.filter((m) => m.role === 'admin').length;
                status.textContent = `${members.length} member${members.length === 1 ? '' : 's'} • ${adminCount} admin${adminCount === 1 ? '' : 's'}`;
            }
        } catch (error) {
            console.error('Failed to load member list:', error);
            container.innerHTML = '<p style="color: #c53030;">Failed to load members. Please try again.</p>';
            if (status) {
                status.textContent = '';
            }
        }
    }

    renderMemberList(members) {
        const container = document.getElementById('member-list-container');
        if (!container) {
            return;
        }

        if (!members || members.length === 0) {
            container.innerHTML = '<p style="color: #666;">No members found.</p>';
            return;
        }

        const sorted = [...members].sort((a, b) => {
            const roleOrder = { admin: 0, adult: 1, child: 2 };
            const roleDiff = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
            if (roleDiff !== 0) return roleDiff;
            return (a.name || '').localeCompare(b.name || '');
        });

        const isAdminUser = this.currentUser?.role === 'admin';
        const currentUserId = this.currentUser?.id;
        const adminCount = members.filter((member) => member.role === 'admin').length;

        container.innerHTML = sorted.map((member) => {
            const roleColor = member.role === 'admin' ? '#2563eb'
                : member.role === 'adult' ? '#2f855a'
                : '#d69e2e';
            const joinedAtRaw = member.created_at || member.createdAt;
            const joinedAt = joinedAtRaw ? this.formatDateTime(joinedAtRaw) : null;
            const roleLabel = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : 'Member';
            const familyId = member.familyId || member.family_id;
            const familyName = member.familyName || member.family_name || null;
            const isSelf = currentUserId && member.id === currentUserId;
            const controlsEnabled = isAdminUser && !isSelf;
            const isLastAdmin = member.role === 'admin' && adminCount <= 1;
            const selectId = `member-role-${member.id}`;

            const managementControls = controlsEnabled ? `
                <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
                    <label for="${selectId}" style="font-size: 12px; color: #4a5568;">Role</label>
                    <select id="${selectId}" class="member-role-select" data-user-id="${member.id}" ${isLastAdmin ? 'disabled' : ''} style="padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5f5;">
                        <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                        <option value="adult" ${member.role === 'adult' ? 'selected' : ''}>Adult</option>
                        <option value="child" ${member.role === 'child' ? 'selected' : ''}>Child</option>
                    </select>
                    <button class="danger-btn member-remove-btn" data-user-id="${member.id}" ${isLastAdmin ? 'disabled title="Family must have at least one admin"' : ''} style="padding: 4px 12px; font-size: 13px;">Remove</button>
                </div>
            ` : '';

            return `
                <div style="padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 10px; background: #fff;">
                    <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                        <div>
                            <strong>${member.name || 'Unnamed Member'}</strong>
                            <div style="color: #666; font-size: 13px; margin-top: 4px;">${member.email || 'No email provided'}</div>
                            ${familyName ? `<div style="color: #4a5568; font-size: 12px; margin-top: 2px;">Family: ${familyName}</div>` : ''}
                        </div>
                        <div style="text-align: right;">
                            <span style="display: inline-block; padding: 4px 10px; border-radius: 9999px; background: ${roleColor}1A; color: ${roleColor}; font-size: 12px; font-weight: 600;">
                                ${roleLabel}
                            </span>
                            ${isSelf ? '<div style="color: #2563eb; font-size: 12px; margin-top: 4px;">(You)</div>' : ''}
                        </div>
                    </div>
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #4a5568;">
                        <span>Member ID: ${member.id || 'N/A'}</span>
                        ${familyId ? `<span>Family ID: ${familyId}</span>` : ''}
                        ${joinedAt ? `<span>Joined: ${joinedAt}</span>` : ''}
                    </div>
                    ${managementControls}
                    ${controlsEnabled && isLastAdmin ? '<div style="margin-top: 6px; font-size: 12px; color: #c53030;">Cannot modify or remove the only admin.</div>' : ''}
                </div>
            `;
        }).join('');

        if (isAdminUser) {
            container.querySelectorAll('.member-role-select').forEach((select) => {
                if (select.disabled) {
                    return;
                }

                select.addEventListener('change', (event) => {
                    const userId = event.target.dataset.userId;
                    const newRole = event.target.value;
                    this.updateMemberRole(userId, newRole);
                });
            });

            container.querySelectorAll('.member-remove-btn').forEach((button) => {
                if (button.disabled) {
                    return;
                }

                button.addEventListener('click', (event) => {
                    const userId = event.currentTarget.dataset.userId;
                    this.removeMember(userId);
                });
            });
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
                const emailStatus = result.emailSent
                    ? 'Invitation email sent via Gmail SMTP.'
                    : `Invitation email not sent: ${result.emailMessage || 'Gmail SMTP not configured.'}`;
                const resendNote = typeof result.resendCount === 'number'
                    ? `\nTotal resends: ${result.resendCount}`
                    : '';
                alert(`Invitation recorded for ${email}.\n${emailStatus}${resendNote}`);
                document.getElementById('invite-form').reset();
                await this.loadFamilyData();
            } else {
                alert(result.error || result.emailMessage || 'Failed to send invitation');
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
        document.getElementById('close-schedules-modal').addEventListener('click', () => this.hideModal('schedules-modal'));
        const closeProfileModal = document.getElementById('close-profile-modal');
        if (closeProfileModal) {
            closeProfileModal.addEventListener('click', () => this.hideModal('profile-modal'));
        }
        
        // Form buttons
        document.getElementById('cancel-btn').addEventListener('click', () => this.hideModal('event-modal'));
        document.getElementById('close-details-btn').addEventListener('click', () => this.hideModal('event-details-modal'));
        document.getElementById('close-schedules-btn').addEventListener('click', () => this.hideModal('schedules-modal'));
        document.getElementById('delete-event-btn').addEventListener('click', () => this.deleteCurrentEvent());
        document.getElementById('edit-event-btn').addEventListener('click', () => this.editEventFromDetails());
        const eventDateInput = document.getElementById('event-date');
        if (eventDateInput) {
            eventDateInput.addEventListener('change', (e) => {
                this.currentBackgroundDate = e.target.value;
                this.updateBackgroundButtonState();
            });
        }
        
        const setBackgroundBtn = document.getElementById('set-background-btn');
        if (setBackgroundBtn) {
            setBackgroundBtn.addEventListener('click', () => this.openBackgroundFromEvent());
        }
        
        document.getElementById('close-background-modal').addEventListener('click', () => this.hideBackgroundModal());
        document.getElementById('background-cancel-btn').addEventListener('click', () => this.hideBackgroundModal());
        document.getElementById('background-save-btn').addEventListener('click', () => this.saveDayBackground());
        document.getElementById('background-remove-btn').addEventListener('click', () => this.removeDayBackgroundForCurrentDate());
        document.getElementById('background-file').addEventListener('change', (e) => this.handleBackgroundFileChange(e));
        
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

        // Floating kebab menu
        this.updateBackgroundButtonState();
        this.initKebabMenu();
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
            const dateKey = this.formatDateForInput(cellDate);
            
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
            
            this.applyDayBackground(dayCell, dateKey);
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

        const dateInput = document.getElementById('event-date');
        const selectedDate = dateInput && dateInput.value
            ? dateInput.value
            : this.formatDateForInput(date || new Date());
        this.currentBackgroundDate = selectedDate;
        this.updateBackgroundButtonState();
        
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
        const formattedTime = this.formatTimeForDisplay(event.time);
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
                <div class="detail-value">${formattedTime}</div>
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
        
        this.currentBackgroundDate = this.currentEditingEvent.date;
        this.updateBackgroundButtonState();
        
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
                    await this.loadDayBackgrounds({ skipRender: true });
                } else {
                    throw new Error('Failed to load events from server');
                }
            } catch (error) {
                console.warn('Server not available, falling back to localStorage:', error);
                this.useServer = false;
                this.loadEventsFromLocalStorage();
                await this.loadDayBackgrounds({ skipRender: true });
            }
        } else {
            this.loadEventsFromLocalStorage();
            await this.loadDayBackgrounds({ skipRender: true });
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
                    time.textContent = this.formatTimeForDisplay(event.time);

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

    formatDateTime(value) {
        if (!value) {
            return 'N/A';
        }

        try {
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) {
                return typeof value === 'string' ? value : 'Invalid date';
            }

            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return typeof value === 'string' ? value : 'Unknown';
        }
    }

    async cancelInvitation(invitationId, button) {
        if (!invitationId) {
            return;
        }

        if (!confirm('Cancel this pending invitation?')) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = 'Cancelling...';
        }

        try {
            const response = await fetch(`/api/family/invitations/${invitationId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || 'Failed to cancel invitation');
            }

            alert(`Invitation for ${result.invitation?.email || 'member'} cancelled.`);
            await this.loadFamilyData();
        } catch (error) {
            console.error('Failed to cancel invitation:', error);
            alert(error.message || 'Failed to cancel invitation');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Cancel';
            }
        }
    }

    async resendInvitation(invitationId, button) {
        if (!invitationId) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = 'Resending...';
        }

        try {
            const response = await fetch(`/api/family/invitations/${invitationId}/resend`, {
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || result.emailMessage || 'Failed to resend invitation');
            }

            const emailStatus = result.emailSent
                ? 'Invitation email sent via Gmail SMTP.'
                : `Invitation email not sent: ${result.emailMessage || 'Gmail SMTP not configured.'}`;
            alert(`Invitation updated.\n${emailStatus}`);
            await this.loadFamilyData();
        } catch (error) {
            console.error('Failed to resend invitation:', error);
            alert(error.message || 'Failed to resend invitation');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Resend';
            }
        }
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

    formatTimeForDisplay(timeString) {
        if (!timeString) {
            return 'All day';
        }

        const raw = String(timeString).trim();
        if (!raw) {
            return 'All day';
        }

        // Detect existing AM/PM formatting and leave as-is
        if (/(am|pm)$/i.test(raw)) {
            return raw.toUpperCase();
        }

        const parts = raw.split(':');
        if (parts.length < 2) {
            return raw;
        }

        const hour = parseInt(parts[0], 10);
        const minute = parseInt(parts[1], 10);

        if (Number.isNaN(hour) || Number.isNaN(minute)) {
            return raw;
        }

        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        const minuteStr = String(minute).padStart(2, '0');

        return `${displayHour}:${minuteStr} ${period}`;
    }

    generateId() {
        return 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    
    async loadDayBackgrounds({ skipRender = false } = {}) {
        if (this.useServer) {
            try {
                const response = await fetch('/api/day-backgrounds', {
                    credentials: 'include'
                });
                if (response.ok) {
                    const payload = await response.json();
                    const map = {};
                    (payload.backgrounds || []).forEach((bg) => {
                        if (bg.date && bg.imageData) {
                            map[bg.date] = bg.imageData;
                        }
                    });
                    this.dayBackgrounds = map;
                    this.saveBackgroundsToLocalStorage();
                } else {
                    console.warn('Failed to load day backgrounds:', response.status);
                }
            } catch (error) {
                console.warn('Failed to load day backgrounds:', error);
            }
        } else {
            this.loadBackgroundsFromLocalStorage();
        }

        this.updateBackgroundButtonState();
        if (!skipRender && this.currentView === 'calendar') {
            this.renderCalendar();
        }
    }

    loadBackgroundsFromLocalStorage() {
        try {
            const stored = localStorage.getItem(BACKGROUND_STORAGE_KEY);
            this.dayBackgrounds = stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.warn('Unable to load backgrounds from localStorage', error);
            this.dayBackgrounds = {};
        }
    }

    saveBackgroundsToLocalStorage() {
        try {
            localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(this.dayBackgrounds));
        } catch (error) {
            console.warn('Unable to save backgrounds to localStorage', error);
        }
    }

    applyDayBackground(dayCell, dateKey) {
        if (!dayCell) {
            return;
        }

        const imageData = this.dayBackgrounds[dateKey];
        if (imageData) {
            dayCell.style.backgroundImage = `url(${imageData})`;
            dayCell.style.backgroundSize = 'cover';
            dayCell.style.backgroundPosition = 'center';
            dayCell.style.backgroundRepeat = 'no-repeat';
            dayCell.classList.add('with-background');
        } else {
            dayCell.style.backgroundImage = '';
            dayCell.classList.remove('with-background');
        }
    }

    updateBackgroundButtonState() {
        const button = document.getElementById('set-background-btn');
        if (!button) {
            return;
        }

        if (this.currentBackgroundDate && this.dayBackgrounds[this.currentBackgroundDate]) {
            button.textContent = 'Change Background Image';
        } else {
            button.textContent = 'Set Background Image';
        }
        button.disabled = !this.currentBackgroundDate;
    }

    openBackgroundFromEvent() {
        const dateInput = document.getElementById('event-date');
        const dateValue = (dateInput && dateInput.value) ? dateInput.value : this.formatDateForInput(new Date());
        this.showBackgroundModal(dateValue);
    }

    showBackgroundModal(dateString) {
        this.currentBackgroundDate = dateString;
        const modal = document.getElementById('background-modal');
        const dateLabel = document.getElementById('background-modal-date');
        const saveBtn = document.getElementById('background-save-btn');
        const removeBtn = document.getElementById('background-remove-btn');
        const fileInput = document.getElementById('background-file');

        if (!modal || !dateLabel || !saveBtn || !removeBtn || !fileInput) {
            console.error('Background modal elements not found');
            return;
        }

        const displayDate = new Date(`${dateString}T00:00:00`);
        dateLabel.textContent = this.formatDateForDisplay(displayDate);

        this.backgroundPreviewData = this.dayBackgrounds[dateString] || null;
        this.backgroundFileDirty = false;
        fileInput.value = '';
        this.updateBackgroundPreview(this.backgroundPreviewData);

        saveBtn.disabled = !this.backgroundPreviewData;
        removeBtn.disabled = !this.dayBackgrounds[dateString];

        modal.style.display = 'block';
    }

    hideBackgroundModal() {
        const modal = document.getElementById('background-modal');
        const fileInput = document.getElementById('background-file');
        const preview = document.getElementById('background-preview');
        const saveBtn = document.getElementById('background-save-btn');
        const removeBtn = document.getElementById('background-remove-btn');

        if (modal) {
            modal.style.display = 'none';
        }
        if (fileInput) {
            fileInput.value = '';
        }
        if (preview) {
            preview.classList.remove('has-image');
            preview.style.backgroundImage = '';
        }
        if (saveBtn) {
            saveBtn.disabled = true;
        }
        if (removeBtn) {
            removeBtn.disabled = !this.currentBackgroundDate || !this.dayBackgrounds[this.currentBackgroundDate];
        }
        this.backgroundPreviewData = null;
        this.backgroundFileDirty = false;
    }

    updateBackgroundPreview(imageData) {
        const preview = document.getElementById('background-preview');
        const saveBtn = document.getElementById('background-save-btn');
        if (!preview || !saveBtn) {
            return;
        }

        if (imageData) {
            preview.style.backgroundImage = `url(${imageData})`;
            preview.classList.add('has-image');
            saveBtn.disabled = false;
        } else {
            preview.style.backgroundImage = '';
            preview.classList.remove('has-image');
            saveBtn.disabled = true;
        }
    }

    handleBackgroundFileChange(event) {
        const files = event.target.files;
        const file = files && files[0];
        if (!file) {
            return;
        }

        if (file.size > BACKGROUND_MAX_SIZE) {
            alert('Image is too large. Please choose a file under 1.5 MB.');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const readerResult = e.target && e.target.result ? e.target.result : null;
            this.backgroundPreviewData = readerResult;
            this.backgroundFileDirty = true;
            this.updateBackgroundPreview(this.backgroundPreviewData);
        };
        reader.readAsDataURL(file);
    }

    async saveDayBackground() {
        if (!this.currentBackgroundDate || !this.backgroundPreviewData) {
            alert('Please choose an image before saving.');
            return;
        }

        try {
            const saveBtn = document.getElementById('background-save-btn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
            }

            await this.setDayBackground(this.currentBackgroundDate, this.backgroundPreviewData);
            alert('Background saved successfully!');
            this.hideBackgroundModal();
            this.updateBackgroundButtonState();
            if (this.currentView === 'calendar') {
                this.renderCalendar();
            }
        } catch (error) {
            console.error('Failed to save background:', error);
            alert('Failed to save background. Please try again.');
        } finally {
            const saveBtn = document.getElementById('background-save-btn');
            if (saveBtn) {
                saveBtn.textContent = 'Save Background';
                saveBtn.disabled = false;
            }
        }
    }

    async removeDayBackgroundForCurrentDate() {
        if (!this.currentBackgroundDate) {
            return;
        }

        if (!this.dayBackgrounds[this.currentBackgroundDate]) {
            alert('No background set for this day.');
            return;
        }

        if (!confirm('Remove the background image for this day?')) {
            return;
        }

        try {
            const removeBtn = document.getElementById('background-remove-btn');
            if (removeBtn) {
                removeBtn.disabled = true;
                removeBtn.textContent = 'Removing...';
            }

            await this.removeDayBackground(this.currentBackgroundDate);
            alert('Background removed.');
            this.hideBackgroundModal();
            this.updateBackgroundButtonState();
            if (this.currentView === 'calendar') {
                this.renderCalendar();
            }
        } catch (error) {
            console.error('Failed to remove background:', error);
            alert('Failed to remove background. Please try again.');
        } finally {
            const removeBtn = document.getElementById('background-remove-btn');
            if (removeBtn) {
                removeBtn.textContent = 'Remove Background';
                removeBtn.disabled = false;
            }
        }
    }

    async setDayBackground(date, imageData) {
        if (!date || !imageData) {
            throw new Error('Invalid background data');
        }

        if (this.useServer) {
            const response = await fetch('/api/day-backgrounds', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ date, imageData })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Failed to save background');
            }

            const payload = await response.json();
            const background = payload.background || payload;
            if (background && background.date && background.imageData) {
                this.dayBackgrounds[background.date] = background.imageData;
            }
        } else {
            this.dayBackgrounds[date] = imageData;
        }

        this.saveBackgroundsToLocalStorage();
    }

    async removeDayBackground(date) {
        if (!date) {
            return;
        }

        if (this.useServer) {
            const response = await fetch(`/api/day-backgrounds/${date}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Failed to remove background');
            }
        } else {
            delete this.dayBackgrounds[date];
            this.saveBackgroundsToLocalStorage();
            return;
        }

        delete this.dayBackgrounds[date];
        this.saveBackgroundsToLocalStorage();
    }
    initKebabMenu() {
        const kebabBtn = document.getElementById('kebab-menu-btn');
        const kebabMenu = document.getElementById('kebab-menu');
        const profileItem = document.getElementById('profile-menu-item');
        const schedulesItem = document.getElementById('schedules-menu-item');
        const exportItem = document.getElementById('export-menu-item');
        const settingsItem = document.getElementById('settings-menu-item');

        if (!kebabBtn || !kebabMenu) {
            console.warn('Kebab menu elements not found');
            return;
        }

        const adminItemId = 'kebab-admin-item';
        let adminItem = document.getElementById(adminItemId);

        if (this.currentUser && this.currentUser.role === 'admin') {
            if (!adminItem) {
                adminItem = document.createElement('div');
                adminItem.id = adminItemId;
                adminItem.className = 'menu-item';
                adminItem.innerHTML = `
                    <span class="menu-icon">🛡️</span>
                    <span class="menu-text">Family Administration</span>
                `;
                kebabMenu.insertBefore(adminItem, kebabMenu.firstChild);
            }
            adminItem.style.display = '';
            adminItem.onclick = () => {
                this.hideKebabMenu();
                this.showFamilyAdmin();
            };
        } else if (adminItem) {
            adminItem.style.display = 'none';
        }

        kebabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleKebabMenu();
        });

        if (schedulesItem) {
            schedulesItem.addEventListener('click', () => {
                this.hideKebabMenu();
                this.handleSchedulesClick();
            });
        }

        if (profileItem) {
            profileItem.addEventListener('click', () => {
                this.hideKebabMenu();
                this.showProfileModal();
            });
        }

        if (exportItem) {
            exportItem.addEventListener('click', () => {
                this.hideKebabMenu();
                this.handleExportClick();
            });
        }

        if (settingsItem) {
            settingsItem.addEventListener('click', () => {
                this.hideKebabMenu();
                this.handleSettingsClick();
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.floating-menu')) {
                this.hideKebabMenu();
            }
        });
    }

    toggleKebabMenu(force) {
        const kebabMenu = document.getElementById('kebab-menu');
        if (kebabMenu) {
            if (typeof force === 'boolean') {
                kebabMenu.classList.toggle('show', force);
            } else {
                kebabMenu.classList.toggle('show');
            }
        }
    }

    hideKebabMenu() {
        this.toggleKebabMenu(false);
    }

    handleSchedulesClick() {
        this.showSchedulesModal();
    }

    showProfileModal() {
        const modal = document.getElementById('profile-modal');
        if (!modal) {
            return;
        }
        this.renderProfileDetails();
        modal.style.display = 'block';
    }

    renderProfileDetails() {
        const container = document.getElementById('profile-details');
        if (!container) {
            return;
        }

        const user = this.currentUser || {};
        const family = this.currentFamily || {};

        const rows = [
            ['Name', user.name || 'Not set'],
            ['Email', user.email || 'Not set'],
            ['Role', (user.role || 'Unknown').charAt(0).toUpperCase() + (user.role || 'Unknown').slice(1)],
            ['Member ID', user.id || 'Unknown'],
            ['Family Name', family.name || family.familyName || family.family_name || user.familyName || user.family_name || 'Unknown'],
            ['Family ID', family.id || user.familyId || user.family_id || 'Unknown'],
            ['Joined', user.created_at ? this.formatDateTime(user.created_at) : user.createdAt ? this.formatDateTime(user.createdAt) : 'Unknown']
        ];

        container.innerHTML = `
            <div class="profile-section">
                <h3>Account</h3>
                ${rows.slice(0, 4).map(([label, value]) => `
                    <div class="profile-row">
                        <span>${label}</span>
                        <span>${value}</span>
                    </div>
                `).join('')}
            </div>
            <div class="profile-section">
                <h3>Family</h3>
                ${rows.slice(4).map(([label, value]) => `
                    <div class="profile-row">
                        <span>${label}</span>
                        <span>${value}</span>
                    </div>
                `).join('')}
            </div>
            ${this.currentUser?.role === 'admin' ? `
                <div class="profile-section profile-actions">
                    <button id="profile-family-admin-btn" class="secondary-btn" style="width: 100%;">Open Family Administration</button>
                </div>
            ` : ''}
        `;

        if (this.currentUser?.role === 'admin') {
            const adminBtn = document.getElementById('profile-family-admin-btn');
            if (adminBtn) {
                adminBtn.addEventListener('click', () => {
                    this.hideModal('profile-modal');
                    this.showFamilyAdmin();
                });
            }
        }
    }

    showSchedulesModal() {
        const modal = document.getElementById('schedules-modal');
        if (modal) {
            modal.style.display = 'block';
            this.initScheduleButtons();
        }
    }

    initScheduleButtons() {
        const attachAlert = (id, message) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.onclick = () => alert(message);
            }
        };

        attachAlert(
            'personal-schedules-btn',
            'Personal schedules\n\nComing soon:\n- Individual family calendars\n- Color coding by person\n- Privacy controls\n- Personalized views'
        );
        attachAlert(
            'recurring-events-btn',
            'Recurring events\n\nComing soon:\n- Weekly, monthly, yearly patterns\n- Custom recurrence rules\n- End dates and exceptions\n- Bulk edits'
        );
        attachAlert(
            'school-schedules-btn',
            'School schedules\n\nComing soon:\n- Import district calendars\n- Class timetables\n- Assignment tracking\n- Notification tools'
        );
        attachAlert(
            'work-schedules-btn',
            'Work schedules\n\nComing soon:\n- Sync with Outlook/Google\n- Meeting reminders\n- Shift tracking\n- Team calendar sharing'
        );
        attachAlert(
            'sports-schedules-btn',
            'Sports schedules\n\nComing soon:\n- Practice times\n- Game schedules\n- Tournament brackets\n- Team communications'
        );
        attachAlert(
            'activities-schedules-btn',
            'Activities & clubs\n\nComing soon:\n- Music lessons\n- Art classes\n- Club meetings\n- Performance dates'
        );
    }

    handleExportClick() {
        this.exportEvents();
    }

    handleSettingsClick() {
        alert('Settings are coming soon!\n\nYou will be able to customize the calendar, set default colors and emojis, manage notifications, and update family profiles.');
    }

    exportEvents() {
        if (!this.events || this.events.length === 0) {
            alert('No events to export. Please add some events first.');
            return;
        }

        const csvHeaders = 'Title,Date,Time,Description,Color,Emoji\n';
        const csvContent = this.events.map(event => {
            const title = `"${(event.title || '').replace(/"/g, '""')}"`;
            const date = event.date || '';
            const time = event.time || '';
            const description = `"${(event.description || '').replace(/"/g, '""')}"`;
            const color = event.color || '';
            const emoji = event.emoji || '';
            return `${title},${date},${time},${description},${color},${emoji}`;
        }).join('\n');

        const blob = new Blob([csvHeaders + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `family-calendar-${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert(`Exported ${this.events.length} event${this.events.length === 1 ? '' : 's'} to CSV.`);
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


