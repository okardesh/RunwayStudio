import { useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { activityCategories } from '../../activities/registry';
import type { ActivityDefinition } from '../../types';
import './ActivityPanel.css';

const FAVORITES: string[] = ['use-app-browser', 'click', 'type-text', 'get-text', 'sequence', 'if', 'navigate-to'];
const RECENT: string[] = ['use-app-browser', 'navigate-to', 'click', 'type-text', 'get-text', 'sequence', 'if', 'delay'];

const allActivities = activityCategories.flatMap((c) => c.activities);
const findActivity = (id: string) => allActivities.find((a) => a.id === id);

function ActivityItem({ activity, indent = false }: { activity: ActivityDefinition; indent?: boolean }) {
  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/rpa-activity', activity.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={`activity-item${indent ? ' activity-item--indent' : ''}`}
      draggable
      onDragStart={handleDragStart}
      title={activity.description}
    >
      <span className="activity-item__icon" style={{ color: activity.color }}>
        {activity.icon}
      </span>
      <span className="activity-item__name">{activity.name}</span>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ap-section">
      <button className="ap-section__hdr" onClick={() => setOpen(!open)}>
        <span className={`ap-section__arrow${open ? ' open' : ''}`}>▸</span>
        <span className="ap-section__title">{title}</span>
      </button>
      {open && <div className="ap-section__body">{children}</div>}
    </div>
  );
}

export function ActivityPanel() {
  const { activitySearchQuery, expandedCategories, setActivitySearchQuery, toggleCategory } = useUiStore();
  const [showSearch, setShowSearch] = useState(false);

  const query = activitySearchQuery.toLowerCase();

  const filteredCategories = activityCategories
    .map((cat) => ({
      ...cat,
      activities: cat.activities.filter(
        (a) =>
          query === '' ||
          a.name.toLowerCase().includes(query) ||
          a.description.toLowerCase().includes(query)
      ),
    }))
    .filter((cat) => cat.activities.length > 0);

  const favoriteActivities = FAVORITES.map(findActivity).filter(Boolean) as ActivityDefinition[];
  const recentActivities = RECENT.map(findActivity).filter(Boolean) as ActivityDefinition[];

  return (
    <div className="activity-panel">
      <div className="activity-panel__header">
        <span className="activity-panel__title">Activities</span>
        <div className="activity-panel__header-actions">
          <button
            className={`ap-hdr-btn${showSearch ? ' active' : ''}`}
            title="Search"
            onClick={() => { setShowSearch(!showSearch); if (showSearch) setActivitySearchQuery(''); }}
          >
            🔍
          </button>
          <button className="ap-hdr-btn" title="Filter">⚙</button>
        </div>
      </div>

      {showSearch && (
        <div className="activity-panel__search">
          <input
            type="text"
            placeholder="Search activities..."
            value={activitySearchQuery}
            onChange={(e) => setActivitySearchQuery(e.target.value)}
            className="activity-panel__search-input"
            autoFocus
          />
          {activitySearchQuery && (
            <button className="activity-panel__clear-btn" onClick={() => setActivitySearchQuery('')}>✕</button>
          )}
        </div>
      )}

      <div className="activity-panel__list">
        {query ? (
          /* Search results mode */
          filteredCategories.length === 0 ? (
            <div className="activity-panel__empty">
              No activities match "{activitySearchQuery}"
            </div>
          ) : (
            filteredCategories.map((category) =>
              category.activities.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))
            )
          )
        ) : (
          /* Normal tree mode */
          <>
            <Section title="Favorites" defaultOpen={false}>
              {favoriteActivities.map((a) => <ActivityItem key={a.id} activity={a} />)}
            </Section>

            <Section title="Recent" defaultOpen={false}>
              {recentActivities.map((a) => <ActivityItem key={a.id} activity={a} />)}
            </Section>

            <Section title="Installed" defaultOpen={false}>
              {activityCategories.map((category) => {
                const isExpanded = expandedCategories.includes(category.id);
                return (
                  <div key={category.id} className="activity-category">
                    <button className="activity-category__header" onClick={() => toggleCategory(category.id)}>
                      <span className={`activity-category__arrow${isExpanded ? ' open' : ''}`}>▸</span>
                      <span className="activity-category__name">{category.name}</span>
                    </button>
                    {isExpanded && (
                      <div className="activity-category__items">
                        {category.activities.map((activity) => (
                          <ActivityItem key={activity.id} activity={activity} indent />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            <Section title="Available" defaultOpen={false}>
              <div className="activity-panel__empty" style={{ padding: '8px 12px' }}>
                No additional packages available.
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

