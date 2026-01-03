function generate() {
  const name = document.getElementById("courseName").value;
  const dueInput = document.getElementById("dueDate").value;
  const minutes = document.getElementById("dailyMinutes").value;
  const output = document.getElementById("output");

  output.innerHTML = "";

  if (!name || !dueInput) {
    alert("Please enter course name and due date.");
    return;
  }

  const due = new Date(dueInput);
  const today = new Date();
  const daysLeft = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  for (let i = 0; i <= daysLeft; i += 2) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const li = document.createElement("li");
    li.textContent = d.toDateString() + ": Study " + minutes + " minutes for " + name;
    output.appendChild(li);
  }
}
