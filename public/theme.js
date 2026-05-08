/**
 * Premium Theme Toggle System
 * Handles Dark/Light mode switching with localStorage persistence
 * and smooth animated transitions
 */

class ThemeManager {
  constructor() {
    this.STORAGE_KEY = 'inventory-theme-preference';
    this.DARK_MODE_CLASS = 'dark-mode';
    
    // Find toggle button - works on both dashboard and login pages
    this.toggleBtn = document.getElementById('themeToggle') || document.getElementById('themeToggleLogin');
    
    // Initialize theme on page load
    this.init();
    
    // Set up event listeners
    this.attachEventListeners();
  }

  /**
   * Initialize theme from localStorage or system preference
   */
  init() {
    const savedTheme = localStorage.getItem(this.STORAGE_KEY);
    
    if (savedTheme) {
      // Use saved preference
      this.setTheme(savedTheme === 'dark');
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.setTheme(prefersDark);
      
      // Store the preference
      this.saveTheme(prefersDark);
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(this.STORAGE_KEY)) {
        this.setTheme(e.matches);
      }
    });
  }

  /**
   * Attach event listeners to toggle button
   */
  attachEventListeners() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
      
      // Add keyboard support
      this.toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggle();
        }
      });
    }
  }

  /**
   * Toggle between dark and light mode
   */
  toggle() {
    const isDarkMode = document.body.classList.contains(this.DARK_MODE_CLASS);
    this.setTheme(!isDarkMode);
    this.saveTheme(!isDarkMode);
    this.playToggleAnimation();
  }

  /**
   * Set theme mode
   * @param {boolean} isDark - True for dark mode, false for light mode
   */
  setTheme(isDark) {
    if (isDark) {
      document.body.classList.add(this.DARK_MODE_CLASS);
    } else {
      document.body.classList.remove(this.DARK_MODE_CLASS);
    }
  }

  /**
   * Save theme preference to localStorage
   * @param {boolean} isDark - True for dark mode, false for light mode
   */
  saveTheme(isDark) {
    localStorage.setItem(this.STORAGE_KEY, isDark ? 'dark' : 'light');
  }

  /**
   * Play toggle animation effect
   */
  playToggleAnimation() {
    if (!this.toggleBtn) return;
    
    // Add a brief scale animation
    this.toggleBtn.style.animation = 'none';
    setTimeout(() => {
      this.toggleBtn.style.animation = '';
    }, 10);
  }

  /**
   * Get current theme
   * @returns {string} 'dark' or 'light'
   */
  getCurrentTheme() {
    return document.body.classList.contains(this.DARK_MODE_CLASS) ? 'dark' : 'light';
  }

  /**
   * Force a specific theme
   * @param {string} theme - 'dark' or 'light'
   */
  setThemeByName(theme) {
    const isDark = theme.toLowerCase() === 'dark';
    this.setTheme(isDark);
    this.saveTheme(isDark);
  }
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ThemeManager();
  });
} else {
  new ThemeManager();
}
