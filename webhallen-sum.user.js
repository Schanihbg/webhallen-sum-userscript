// ==UserScript==
// @name         Webhallen user stats
// @namespace    Webhallen
// @version      0.8
// @description  Generate a statistics button and present a wide variety of stats from the users account. Note: This is a proof of concept and could be highly unstable, use at your own risk!
// @author       Schanii, tsjost, and Furiiku
// @match        https://www.webhallen.com/se/member/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=webhallen.com
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  let ME = null;
  let MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  let isFetching = false;
  let data = null;

  async function fetchAPI(uri, params = null) {
      let resp;
      const url = new URL(uri);
      if (params) {
          Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
      }

      await fetch(url.toString())
          .then((response) => {
          // The API call was successful!
          return response.json();
      })
          .then((data) => {
          // This is the JSON from our response
          resp = data;
      })
          .catch((err) => {
          // There was an error
          console.warn("Something went wrong.", err);
      });
      console.log("callURL resp", resp);
      return resp;
  }

  function filterJson(jsonObject, keysToInclude) {
      return Object.keys(jsonObject).reduce((acc, key) => (keysToInclude.includes(key) && (acc[key] = jsonObject[key]), acc), {});
  }

  async function fetchMe() {
      const data = await fetchAPI('https://www.webhallen.com/api/me');
      const filteredData = filterJson(data.user, ['id', 'experiencePoints']);
      return filteredData;
  }

  async function fetchOrders(whId) {
      let page = 1;
      let orders = [];

      while (true) {
          const params = { page: page };
          const data = await fetchAPI(`https://www.webhallen.com/api/order/user/${encodeURIComponent(whId)}?filters[history]=true&sort=orderStatus`, params);
          if (data.orders.length === 0) break;
          orders.push(...data.orders.map(order => order));
          page++;
      }

      return orders;
  }

  async function fetchAchievements(whId) {
      const data = await fetchAPI(`https://www.webhallen.com/api/user/${encodeURIComponent(whId)}/achievements`);
      return data;
  }

async function fetchSupplyDrops() {
    const data = await fetchAPI(`https://www.webhallen.com/api/supply-drop/`);
    return data;
}

  function getOrderDatesPerMonthWithSumKillstreak(orders) {
      const groupedData = Object.entries(orders.reduce((acc, { orderDate, sentDate, totalSum }) => {
          const dateOrdered = new Date(orderDate * 1000);
          const orderedYear = dateOrdered.getUTCFullYear();
          const orderedMonth = dateOrdered.getUTCMonth();

          const dateSent = new Date(sentDate * 1000);
          const sentYear = dateSent.getUTCFullYear();
          const sentMonth = dateSent.getUTCMonth();

        const sentKey = new Date(Date.UTC(sentYear, sentMonth)).getTime() / 1000;
        if (!acc[sentKey]) {
            acc[sentKey] = { totalSum: totalSum };
        } else {
            acc[sentKey].totalSum += totalSum;
        }
        
        if ( sentYear != orderedYear || sentMonth != orderedMonth ) {
          const orderKey = new Date(Date.UTC(orderedYear, orderedMonth)).getTime() / 1000;
          if (!acc[orderKey]) {
              acc[orderKey] = { totalSum: totalSum };
          } else {
              acc[orderKey].totalSum += totalSum;
          }
        }

          return acc;
      }, {})).map(([key, { totalSum }]) => ({
          sentDate: parseInt(key, 10),
          totalSum,
      }));

      const sortedGroupedData = groupedData.sort((a, b) => a.sentDate - b.sentDate);
      return sortedGroupedData;
  }

  function getOrderDatesPerMonthWithSum(orders) {
      const groupedData = Object.entries(orders.reduce((acc, { orderDate, sentDate, totalSum }) => {
          const dateOrdered = new Date(orderDate * 1000);
          const orderedYear = dateOrdered.getUTCFullYear();
          const orderedMonth = dateOrdered.getUTCMonth();

          const orderKey = new Date(Date.UTC(orderedYear, orderedMonth)).getTime() / 1000;
          if (!acc[orderKey]) {
              acc[orderKey] = { totalOrders: 1, totalSum: totalSum };
          } else {
              acc[orderKey].totalOrders += 1;
              acc[orderKey].totalSum += totalSum;
          }

          return acc;
      }, {})).map(([key, { totalOrders, totalSum }]) => ({
          orderDate: parseInt(key, 10),
          totalOrders,
          totalSum,
      }));

      const sortedGroupedData = groupedData.sort((a, b) => a.orderDate - b.orderDate);
      return sortedGroupedData;
  }

  function findCategoriesByPeriod(orders, beginDate = "1999-01-01", endDate = new Date()) {
      const catStartDate = Date.parse(beginDate);
      const catEndDate = Date.parse(endDate);

      const filteredOrders = orders.filter(order => {
          const orderDate = new Date(order.orderDate * 1000);
          return orderDate >= catStartDate && orderDate <= catEndDate;
      });

      let unsortedCategories = {};
      filteredOrders.forEach(order => {order.rows.forEach(item => {
          const categories = item.product.categoryTree.split('/');
          const topLevel = categories[0];
          const subcategory = categories.length > 1 ? categories[1] : null;
          const categoryString = topLevel + (subcategory !== null ? '/' + subcategory : '');

          unsortedCategories[categoryString] = (unsortedCategories[categoryString] || 0) + 1
      })});

      const sortedKeys = Object.keys(unsortedCategories).sort();
      const sortedCategories = {};
      sortedKeys.forEach(key => { sortedCategories[key] = unsortedCategories[key]; });

      return sortedCategories;
  }

  function findOrdersPerMonth(orders) {
      let monthCounts = {};
      (getOrderDatesPerMonthWithSum(orders)).forEach(period => {
          const currentDate = new Date(period.orderDate * 1000)
          const yearMonth = `${currentDate.getUTCFullYear()} ${MONTH_NAMES[currentDate.getUTCMonth()]}`;
          monthCounts[yearMonth] = {totalOrders: period.totalOrders, totalSum: period.totalSum};
      });

      return monthCounts;
  }

  function findStreaks(orders, minimumSum = 500) {
      const cheevoStartDate = Date.parse("2015-09-01");
      const sentDates = getOrderDatesPerMonthWithSumKillstreak(orders);

      let output = { streaks: [], longestStreak: 0, currentStreak: 0 };
      let previousDate = null;
      let lastYearMonth = null;
      let currentStreakStart = null;
      for (let i = 0; i < sentDates.length; i++) {
          const currentDate = new Date(sentDates[i].sentDate * 1000);
          const yearMonth = `${currentDate.getUTCFullYear()} ${MONTH_NAMES[currentDate.getUTCMonth()]}`;

          // Only count streaks after Killstreak cheevo creation date
          if (currentDate < cheevoStartDate) continue;

          if (previousDate === null) {
              previousDate = currentDate;
              lastYearMonth = yearMonth;
              currentStreakStart = yearMonth;
          } else {
            const m1 = previousDate.getUTCMonth();
            const m2 = currentDate.getUTCMonth();
            const isConsecutive = m2 - m1 === 1 || m2 - m1 === -11;

            if (sentDates[i].totalSum >= minimumSum) {
              if (isConsecutive) {
                output.currentStreak++;
              } else {
                if (output.currentStreak > 0) {
                  output.streaks.push({start: currentStreakStart, end: lastYearMonth, months: output.currentStreak});
                }
                output.currentStreak = 0;
                currentStreakStart = yearMonth;
              }
              lastYearMonth = yearMonth;
              previousDate = currentDate;
            } else {
              if (output.currentStreak > 0) {
                output.streaks.push({start: currentStreakStart, end: lastYearMonth, months: output.currentStreak});
              }
              output.currentStreak = 0;
              currentStreakStart = yearMonth;
            }

            output.longestStreak = Math.max(output.longestStreak, output.currentStreak);
            lastYearMonth = yearMonth;
            previousDate = currentDate;
          }
      }
      if (output.currentStreak > 0) {
        output.streaks.push({start: currentStreakStart, end: lastYearMonth, months: output.currentStreak});
      }

      return output;
  }

  function getExperienceStats(me, orders, achievements, supplyDrops) {
      let output = { 'purchases': 0, 'bonusXP': 0, 'achievements': 0, 'supplyDrops': 0, 'other': 0, 'total': 0 }

      orders.forEach(order => {
          output.purchases += order.totalSum;

          if (order.userExperiencePointBoosts) {
              order.userExperiencePointBoosts.forEach(boost => {
                  output.bonusXP += boost.experiencePoints;
              });
          }
      });

      const earnedAchievements = achievements.achievements.filter(item => item.achievedPercentage >= 1);
      earnedAchievements.forEach(achievement => { output.achievements += achievement.experiencePoints });

      supplyDrops.drops.forEach(drop => {
          const xpValue = parseInt(drop.item.description.replace("XP", "").trim());
          if (isNaN(xpValue)) return;

          output.supplyDrops += xpValue * drop.count;
      });

      output.total = output.purchases + output.bonusXP + output.achievements + output.supplyDrops;
      if (output.total < me.experiencePoints) {
          output.other = me.experiencePoints - output.total;
          output.total += output.other;
      }

      output.purchases = parseInt(output.purchases).toLocaleString('sv');
      output.bonusXP = parseInt(output.bonusXP).toLocaleString('sv');
      output.achievements = parseInt(output.achievements).toLocaleString('sv');
      output.supplyDrops = parseInt(output.supplyDrops).toLocaleString('sv');
      output.other = output.other.toLocaleString('sv');
      output.total = output.total.toLocaleString('sv');

      return output;
  }

  function findTopHoarderCheevoStats(orders, count = 10) {
      let itemCount = {};
      orders.forEach(order => { order.rows.forEach(item => {
          const id = item.product.id;

          if (!itemCount[id]) {
              itemCount[id] = { id: id, name: item.product.name, bought: 1 };
          } else {
              itemCount[id].bought += item.quantity;
          }
      })});

      const dataArray = Object.values(itemCount);
      const filteredArray = dataArray.filter(product => product.bought > 1);
      filteredArray.sort((a, b) => b.bought - a.bought);

      return filteredArray.slice(0, count);
  }

  function addSortingFunctionality(table, headers) {
      let thead = table.querySelector("thead");
      let headerRow = thead.querySelector("tr");

      headerRow.childNodes.forEach(function (header, index) {
          header.addEventListener("click", function () {
              sortTable(table, index, headers);
          });
      });

      function sortTable(table, columnIndex, headers) {
          let rows,
              switching,
              i,
              x,
              y,
              shouldSwitch,
              dir,
              switchcount = 0;
          switching = true;
          dir = "asc"; // Default sorting direction

          while (switching) {
              switching = false;
              rows = table.querySelector("tbody").rows;

              for (i = 0; i < rows.length - 1; i++) {
                  shouldSwitch = false;
                  x = rows[i].getElementsByTagName("td")[columnIndex];
                  y = rows[i + 1].getElementsByTagName("td")[columnIndex];

                  let xContent = x.textContent.toLowerCase();
                  let yContent = y.textContent.toLowerCase();

                  // Check if sorting is for string or number
                  if (columnIndex === 0) {
                      shouldSwitch =
                          dir === "asc" ? xContent > yContent : xContent < yContent;
                  } else if (columnIndex === 1) {
                      shouldSwitch =
                          dir === "asc"
                          ? parseInt(xContent) > parseInt(yContent)
                      : parseInt(xContent) < parseInt(yContent);
                  } else if (columnIndex === 2) {
                      shouldSwitch =
                          dir === "asc"
                          ? parseInt(xContent) > parseInt(yContent)
                      : parseInt(xContent) < parseInt(yContent);
                  }

                  if (shouldSwitch) {
                      rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                      switching = true;
                      switchcount++;
                  }
              }

              // Toggle the sorting direction if a switch occurred
              if (switchcount === 0 && dir === "asc") {
                  dir = "desc";
                  switching = true;
              }
          }

          // Update header text with arrow indicator
          let arrow = dir === "asc" ? "▲" : "▼";
          headerRow.childNodes.forEach(function (header, index) {
              let arrowIndicator = index === columnIndex ? arrow : "";
              header.textContent = headers[index] + arrowIndicator;
          });
      }
  }

  function generateMonthsTable(jsonData) {
      let table = document.createElement('table');
      table.className = "table table-condensed table-striped tech-specs-table";

      let thead = document.createElement('thead');
      let headerRow = document.createElement('tr');
      let headers = ['År Månad', 'Totalt antal ordrar', 'Total summa'];
      let finalSum = 0;
      let finalOrders = 0;

      headers.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      let tbody = document.createElement('tbody');

      for (let month in jsonData) {
          let row = document.createElement('tr');
          let data = jsonData[month];

          let cell1 = document.createElement('td');
          let cell2 = document.createElement('td');
          let cell3 = document.createElement('td');

          cell1.textContent = month;
          cell2.textContent = data.totalOrders;
          cell3.textContent = data.totalSum;

          finalOrders += data.totalOrders;
          finalSum += data.totalSum;

          row.appendChild(cell1);
          row.appendChild(cell2);
          row.appendChild(cell3);

          tbody.appendChild(row);
      }

      let footer = document.createElement('tfoot');
      let finalRow = document.createElement('tr');
      let cell1 = document.createElement('td');
      let cell2 = document.createElement('td');
      let cell3 = document.createElement('td');

      cell1.innerHTML = "<strong>Totalt</strong>";
      cell2.innerHTML = `<strong>${finalOrders}</strong>`;
      cell3.innerHTML = `<strong>${finalSum}</strong>`;

      finalRow.appendChild(cell1);
      finalRow.appendChild(cell2);
      finalRow.appendChild(cell3);
      footer.appendChild(finalRow);

      table.appendChild(tbody);
      table.appendChild(footer);

      addSortingFunctionality(table, headers);

      return table;
  }

  function generateStreaksTable(jsonData) {
      let div = document.createElement('div');

      let table1 = document.createElement('table');
      table1.className = "table table-condensed table-striped tech-specs-table";

      let thead1 = document.createElement('thead');
      let headerRow1 = document.createElement('tr');
      let headers1 = ['Längsta streak', 'Nuvarande streak'];

      headers1.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow1.appendChild(th);
      });

      thead1.appendChild(headerRow1);
      table1.appendChild(thead1);

      let tbody1 = document.createElement('tbody');
      let row1 = document.createElement('tr');
      let cell1_1 = document.createElement('td');
      let cell1_2 = document.createElement('td');

      cell1_1.textContent = jsonData.longestStreak;
      cell1_2.textContent = jsonData.currentStreak;

      row1.appendChild(cell1_1);
      row1.appendChild(cell1_2);

      tbody1.appendChild(row1);
      table1.appendChild(tbody1);

      /* --- */

      let table2 = document.createElement('table');
      table2.className = "table table-condensed table-striped tech-specs-table";

      let thead2 = document.createElement('thead');
      let headerRow2 = document.createElement('tr');
      let headers2 = ['Streak började', 'Streak slutade', 'Antal månader'];

      headers2.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow2.appendChild(th);
      });

      thead2.appendChild(headerRow2);
      table2.appendChild(thead2);

      let tbody2 = document.createElement('tbody');

      jsonData.streaks.forEach(streak => {
          let row2 = document.createElement('tr');
          let cell2_1 = document.createElement('td');
          let cell2_2 = document.createElement('td');
          let cell2_3 = document.createElement('td');

          cell2_1.textContent = streak.start;
          cell2_2.textContent = streak.end;
          cell2_3.textContent = streak.months;

          row2.appendChild(cell2_1);
          row2.appendChild(cell2_2);
          row2.appendChild(cell2_3);

          tbody2.appendChild(row2);
      });

      table2.appendChild(tbody2);

      div.appendChild(table1);
      div.appendChild(table2);

      return div;
  }

  function generateCategoriesTable(jsonData) {
      let table = document.createElement('table');
      table.className = "table table-condensed table-striped tech-specs-table";

      let thead = document.createElement('thead');
      let headerRow = document.createElement('tr');
      let headers = ['Kategori', 'Antal produkter'];

      headers.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      let tbody = document.createElement('tbody');

      for (let category in jsonData) {
          let row = document.createElement('tr');
          let data = jsonData[category];

          let cell1 = document.createElement('td');
          let cell2 = document.createElement('td');

          cell1.textContent = category;
          cell2.textContent = data;

          row.appendChild(cell1);
          row.appendChild(cell2);

          tbody.appendChild(row);
      }

      table.appendChild(tbody);

      addSortingFunctionality(table, headers);

      return table;
  }

  function generateHoarderTable(jsonData) {
      let table = document.createElement('table');
      table.className = "table table-condensed table-striped tech-specs-table";

      let thead = document.createElement('thead');
      let headerRow = document.createElement('tr');
      let headers = ['Produkt', 'Antal köpta'];

      headers.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      let tbody = document.createElement('tbody');

      jsonData.forEach(product => {
          let row = document.createElement('tr');
          let cell1 = document.createElement('td');
          let cell2 = document.createElement('td');

          let link = document.createElement('a');
          link.href = "https://www.webhallen.com/" + product.id;
          link.appendChild(document.createTextNode("[" + product.id + "] " + product.name));

          cell1.appendChild(link);
          cell2.textContent = product.bought;

          row.appendChild(cell1);
          row.appendChild(cell2);

          tbody.appendChild(row);
      });

      table.appendChild(tbody);

      return table;
  }

  function generateExperienceTable(jsonData) {
      let table = document.createElement('table');
      table.className = "table table-condensed table-striped tech-specs-table";

      let thead = document.createElement('thead');
      let headerRow = document.createElement('tr');
      let headers = ['Köp XP', 'Bonus XP', 'Cheevo XP', 'Supply drop XP', 'Övriga XP', 'Totalt'];

      headers.forEach(function(header) {
          let th = document.createElement('th');
          th.textContent = header;
          headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      let tbody = document.createElement('tbody');

      let row = document.createElement('tr');
      let cell1 = document.createElement('td');
      let cell2 = document.createElement('td');
      let cell3 = document.createElement('td');
      let cell4 = document.createElement('td');
      let cell5 = document.createElement('td');
      let cell6 = document.createElement('td');

      cell1.textContent = jsonData.purchases;
      cell2.textContent = jsonData.bonusXP;
      cell3.textContent = jsonData.achievements;
      cell4.textContent = jsonData.supplyDrops;
      cell5.textContent = jsonData.other;
      cell6.textContent = jsonData.total;

      row.appendChild(cell1);
      row.appendChild(cell2);
      row.appendChild(cell3);
      row.appendChild(cell4);
      row.appendChild(cell5);
      row.appendChild(cell6);

      tbody.appendChild(row);

      table.appendChild(tbody);

      return table;
  }

  function addDataToDiv(headerText, domObject) {
      let div = document.createElement('div');
      div.className = "order my-4";

      let table = document.createElement('table');
      table.className = 'table table-condensed';

      let tbody = document.createElement('tbody');

      let tr = document.createElement('tr');
      tr.className = 'order-id-wrap';

      let td = document.createElement('td');
      td.textContent = headerText;

      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      div.appendChild(table);


      let div1 = document.createElement('div');
      let div2 = document.createElement('div');
      let orderProgression = document.createElement('div');
      let innerContainer = document.createElement('div');
      let orderStatusEvent = document.createElement('div');
      let icon = document.createElement('div');
      let header = document.createElement('h3');
      let secondary = document.createElement('div');

      div1.appendChild(div2);
      div2.appendChild(orderProgression);
      orderProgression.appendChild(innerContainer);
      innerContainer.appendChild(orderStatusEvent);
      orderStatusEvent.appendChild(icon);
      orderStatusEvent.appendChild(header);
      orderStatusEvent.appendChild(secondary);
      secondary.appendChild(domObject);

      header.className = 'level-two-heading';
      icon.className = 'icon';

      header.textContent = '';

      div.appendChild(div1);

      return div;
  }

  function findInjectPath(paths) {
      let dom = null;
      paths.forEach(path => {
          const d = document.querySelector(path);
          if (d) {
              dom = d;
              return;
          }
      });

      return dom;
  }

  async function _clearAndAddStatistics(event) {
      event.preventDefault();
      let clickedLink = event.target;

      let allLinks = document.querySelectorAll('.router-link-exact-active.router-link-active');
      allLinks.forEach(function(link) {
          link.classList.remove('router-link-exact-active', 'router-link-active');
      });

      clickedLink.classList.add('router-link-exact-active', 'router-link-active');

      let content = `
    <h2 class="level-one-heading mb-5">Min statistik</h2><hr>
    <div class="mb-5">Här hittar du statistik om din aktivitet på webhallen.</div>
    <div class="list-settings">
      <button class="toggle-btn" aria-label="Experience"><span class="toggle-text">Experience</span></button>
      <button class="toggle-btn" aria-label="Streaks"><span class="toggle-text">Streaks</span></button>
      <button class="toggle-btn" aria-label="Hoarder"><span class="toggle-text">Hoarder</span></button>
      <button class="toggle-btn" aria-label="Categories"><span class="toggle-text">Categories</span></button>
      <button class="toggle-btn" aria-label="Orders by month"><span class="toggle-text">Orders by month</span></button>
    </div>
    `

    let paths = ['section',
                  'div.member-subpage',
                  'div.container'];
    let injectPath = findInjectPath(paths);

    injectPath.innerHTML = content;

    const currentView = injectPath.appendChild(document.createElement("div"));
    currentView.setAttribute('id', 'statsViewContainer')

    const buttons = injectPath.getElementsByTagName('button');

    addButtonEvents(buttons);

    // Default view
    showLoader();
    showExperience()
}

  function addButtonEvents(buttons) {
      for (let button of buttons) {
          const onClick = getButtonClickFunction(button.ariaLabel);
          button.addEventListener("click", async (e) => {
              e.preventDefault();
              for (let b of buttons) {
                  b.classList.remove('active');
              }
              button.classList.add('active');

              if (isFetching) {
                  return showLoader();
              }

              onClick();
          })
      };
  }

  function getButtonClickFunction(ariaLabel) {
      switch (ariaLabel) {
          case "Experience":
              return showExperience
          case "Streaks":
              return showStreaks
          case "Hoarder":
              return showHoarder
          case "Categories":
              return showCategories
          case "Orders by month":
              return showOrderByMonth
          default:
              return () => null
      }
  }

  async function showStreaks(event) {
      const {orders} = await useData();

      const streaks = findStreaks(orders);
      if (streaks) {
          document.getElementById('statsViewContainer').replaceChildren(generateStreaksTable(streaks));
      }
  }

  async function showHoarder(event) {
      const {orders} = await useData();

      const hoarders = findTopHoarderCheevoStats(orders, 10);
      if (hoarders) {
          document.getElementById('statsViewContainer').replaceChildren(generateHoarderTable(hoarders));
      }
  }

  async function showCategories(event) {
      const {orders} = await useData();

      const categories = findCategoriesByPeriod(orders);
      if (categories) {
          document.getElementById('statsViewContainer').replaceChildren(generateCategoriesTable(categories));
      }
  }

  async function showOrderByMonth(event) {
      const {orders} = await useData();

      const ordersByMonth = findOrdersPerMonth(orders);
      if (ordersByMonth) {
          document.getElementById('statsViewContainer').replaceChildren(generateMonthsTable(ordersByMonth));
      }
  }

  async function showExperience(event) {
      const {orders, supplyDrops, achievements} = await useData();

      const experience = getExperienceStats(ME, orders, achievements, supplyDrops);
      if (experience) {
          document.getElementById('statsViewContainer').replaceChildren(generateExperienceTable(experience));
      }
  }

  function showLoader() {
      let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      let image = document.createElementNS("http://www.w3.org/2000/svg", "image");
      image.setAttribute("href", 'https://cdn.webhallen.com/img/loading_light.svg');
      svg.appendChild(image);
      document.getElementById('statsViewContainer').replaceChildren(svg);
  }

  function showError(error) {
      document.getElementById('statsViewContainer').innerHTML = "Något gick fel..."
      console.log(error);
  }

  async function useData() {
      if (!isFetching && !data) {
          isFetching = true;
          try {
              let orders, supplyDrops, achievements;
              [orders, supplyDrops, achievements] = await Promise.all([
                  fetchOrders(ME.id),
                  fetchSupplyDrops(ME.id),
                  fetchAchievements(ME.id)
              ]);
              data = {orders, supplyDrops, achievements};
          } catch(e) {
              showError(e);
          }
          isFetching = false;
      }
      return data;
  }

  function addLink() {
      clearInterval(timerId);
      let ul = document.querySelector('.member-nav .desktop-wrap .nav');

      if (ul) {
          let li = document.createElement('li');
          li.className = 'tile';
          let link = document.createElement('a');
          link.href = '#';

          let image = document.createElement('img');
          image.src = '//cdn.webhallen.com/img/icons/member/topplistor.svg';
          image.className = 'member-icon';
          image.alt = 'Statistik';

          link.appendChild(image);
          link.appendChild(document.createTextNode('Statistik'));
          link.addEventListener('click', _clearAndAddStatistics);
          li.appendChild(link);
          ul.appendChild(li);
      } else {
          console.error("UL element not found using XPath.");
      }
  }

  async function main() {
      ME = await fetchMe();
      if (!ME) return;

      addLink();
  }

  let timerId = setInterval(main, 1000);
})();
