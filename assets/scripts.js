// assets/scripts.js - Shared JS for collapsibles, etc.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.collapsible').forEach(item => {
        item.addEventListener('click', () => item.classList.toggle('active'));
    });
});