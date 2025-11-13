/* Toggle Dropdown */
function showFilters() {
    const menu = document.getElementById('filterMenu');
    menu.classList.toggle('hidden');
}

/* Toggle Karten-/Tabellenansicht */
function toggleView() {
    const cardView = document.getElementById('cardView');
    const tableView = document.getElementById('tableView');
    const btn = document.getElementById('toggleViewBtn');
    cardView.classList.toggle('hidden');
    tableView.classList.toggle('hidden');
    btn.textContent = tableView.classList.contains('hidden') ? 'Tabellenansicht' : 'Kartenansicht';
}

/* Filter & Suche */
function filterUsers() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('#cardView .user-card, #tableView tbody tr').forEach(el => {
        const username = el.dataset.username.toLowerCase();
        if(username.includes(query)) {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });
}

function filterStatus(status) {
    document.querySelectorAll('#cardView .user-card, #tableView tbody tr').forEach(el => {
        if(status === 'all' || el.dataset.status === status) {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });
}

/* Placeholder "+" Button Funktion */
function addUser() {
    alert('User hinzufügen!');
}